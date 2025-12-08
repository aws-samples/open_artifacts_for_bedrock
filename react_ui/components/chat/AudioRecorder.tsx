import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Mars, Venus } from 'lucide-react';

interface AudioRecorderProps {
  apiKey: string;
  userId: string;
  mcpServerIds?: string[]; // Added mcpServerIds parameter
  onTranscription?: (text: string, isUser?: boolean) => void;
  onToolUse?: (toolUse: any) => void;
  onToolResult?: (toolResult: any) => void;
}

// Voice type options
type VoiceType = "matthew" | "tiffany" | "amy";

// Define a type for our audio processor node that can be either modern or legacy
type AudioProcessorNode = AudioWorkletNode | ScriptProcessorNode;

// Define audio chunk types
type AudioChunk = Blob | {
  audioData: ArrayBuffer;
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
};

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  apiKey,
  userId,
  mcpServerIds,
  onTranscription,
  onToolUse,
  onToolResult
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');
  const [voiceType, setVoiceType] = useState<VoiceType>("matthew");
    
  // Function to handle voice type change
  const handleVoiceChange = async (voice: VoiceType) => {
    // If we're recording, don't allow voice change
    if (isRecording) {
      return;
    }
    
    // Force immediate state update for UI
    setVoiceType(prevVoice => {
      return voice;
    });
    
    // If connected, we need to disconnect and reconnect with new voice
    if (isConnected) {
      // Update status to inform user
      setStatus(`Switching to ${voice} voice...`);
      
      // Disconnect WebSocket
      disconnectWebSocket();
      
      // Wait for disconnection to complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Reconnect with new voice - explicitly pass the voice parameter
      try {
        setIsConnecting(true);
        const connected = await connectWebSocket(voice);
        if (!connected) {
          setError("Failed to reconnect with new voice");
          setStatus("Connection failed");
        } else {
          setStatus(`Connected with ${voice} voice`);
        }
      } catch (err) {
        console.error("Failed to reconnect after voice change:", err);
        setError(`Connection error: ${err}`);
        setStatus("Connection failed");
      } finally {
        setIsConnecting(false);
      }
    } else {
      // Just update status if not connected
      setStatus(`Selected ${voice} voice`);
    }
  };
  
  // Web Audio API 相关引用
  const websocketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorNodeRef = useRef<AudioProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Audio playback references
  const audioQueueRef = useRef<AudioChunk[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const audioContextPlaybackRef = useRef<AudioContext | null>(null);
  const lastSampleRef = useRef<Float32Array | null>(null); // Store last few samples for crossfading
  const crossfadeSamples = 128; // Number of samples to use for crossfading
  
  // Function to apply a simple low-pass filter to reduce high-frequency noise
  const applyLowPassFilter = (samples: Float32Array<ArrayBufferLike>): Float32Array<ArrayBufferLike> => {
    const result = new Float32Array(samples.length);
    const alpha = 0.2; // Filter strength (0-1), higher means more filtering
    
    let lastSample = 0;
    for (let i = 0; i < samples.length; i++) {
      // Simple first-order low-pass filter: y[n] = α * x[n] + (1-α) * y[n-1]
      result[i] = alpha * samples[i] + (1 - alpha) * lastSample;
      lastSample = result[i];
    }
    
    return result;
  };
  
  // Function to apply fade in/out to reduce clicks and pops
  const applyFades = (samples: Float32Array<ArrayBufferLike>, fadeInSamples: number = 64, fadeOutSamples: number = 64): Float32Array<ArrayBufferLike> => {
    const result = new Float32Array(samples);
    
    // Apply fade in
    for (let i = 0; i < Math.min(fadeInSamples, samples.length); i++) {
      const gain = i / fadeInSamples;
      result[i] = samples[i] * gain;
    }
    
    // Apply fade out
    const fadeOutStart = Math.max(0, samples.length - fadeOutSamples);
    for (let i = fadeOutStart; i < samples.length; i++) {
      const gain = (samples.length - i) / fadeOutSamples;
      result[i] = samples[i] * gain;
    }
    
    return result;
  };
  
  // Function to crossfade between audio chunks to reduce clicks
  const applyCrossfade = (currentSamples: Float32Array<ArrayBufferLike>, lastSamples: Float32Array | null): Float32Array<ArrayBufferLike> => {
    const result = new Float32Array(currentSamples);
    if (!lastSamples || lastSamples.length === 0) {
      return result;
    }
    const fadeLength = Math.min(crossfadeSamples, lastSamples.length, currentSamples.length);
    
    // Apply crossfade at the beginning of the current chunk
    for (let i = 0; i < fadeLength; i++) {
      const ratio = i / fadeLength;
      const lastIdx = lastSamples.length - fadeLength + i;
      if (lastIdx >= 0 && lastIdx < lastSamples.length) {
        // Linear crossfade: fade out last chunk while fading in current chunk
        result[i] = (currentSamples[i] * ratio) + (lastSamples[lastIdx] * (1 - ratio));
      }
    }
    
    return result;
  };
  
  // Function to normalize audio to prevent clipping
  const normalizeAudio = (samples: Float32Array<ArrayBufferLike>, targetLevel: number = 0.8): Float32Array<ArrayBufferLike> => {
    // Find the maximum amplitude
    let maxAmp = 0;
    for (let i = 0; i < samples.length; i++) {
      maxAmp = Math.max(maxAmp, Math.abs(samples[i]));
    }
    
    // If the audio is already below target level, don't change it
    if (maxAmp <= targetLevel) {
      return samples;
    }
    
    // Calculate gain to bring max amplitude to target level
    const gain = targetLevel / maxAmp;
    
    // Apply gain
    const result = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      result[i] = samples[i] * gain;
    }
    
    return result;
  };
  
  // Function to play audio chunks (both PCM and Blob)
  const playNextAudioChunk = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    
    isPlayingRef.current = true;
    
    try {
      // Get the next audio chunk from the queue
      const audioChunk = audioQueueRef.current.shift();
      if (!audioChunk) {
        isPlayingRef.current = false;
        return;
      }
      
      // Create AudioContext if it doesn't exist
      if (!audioContextPlaybackRef.current) {
        audioContextPlaybackRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      // Process based on the type of audio chunk
      if ('audioData' in audioChunk) {
        // This is PCM data
        try {
          // Get the PCM data
          const pcmData = audioChunk.audioData;
          const sampleRate = audioChunk.sampleRate;
          
          // Create an audio buffer with the correct sample rate
          const audioBuffer = audioContextPlaybackRef.current.createBuffer(
            audioChunk.channels,
            pcmData.byteLength / (audioChunk.bitsPerSample / 8),
            sampleRate
          );
          
          // Convert Int16Array to Float32Array for the audio buffer
          const channelData = audioBuffer.getChannelData(0);
          const int16Data = new Int16Array(pcmData);
          
          // Convert from 16-bit PCM to float
          for (let i = 0; i < int16Data.length; i++) {
            // Convert from [-32768, 32767] to [-1, 1]
            channelData[i] = int16Data[i] / 32768.0;
          }
          
          // Apply audio processing to improve quality and reduce artifacts
          let processedData: Float32Array<ArrayBufferLike> = channelData;
          
          // Apply low-pass filter to reduce high-frequency noise
          processedData = applyLowPassFilter(processedData);
          
          // Apply crossfade with previous chunk if available
          if (lastSampleRef.current) {
            processedData = applyCrossfade(processedData, lastSampleRef.current);
          }
          
          // Apply fade in/out to reduce clicks
          processedData = applyFades(processedData);
          
          // Normalize audio to prevent clipping
          processedData = normalizeAudio(processedData);
          
          // Copy processed data back to the audio buffer
          for (let i = 0; i < processedData.length; i++) {
            channelData[i] = processedData[i];
          }
          
          // Store the last part of this chunk for crossfading with the next chunk
          const lastSampleSize = Math.min(crossfadeSamples, channelData.length);
          lastSampleRef.current = new Float32Array(lastSampleSize);
          for (let i = 0; i < lastSampleSize; i++) {
            lastSampleRef.current[i] = channelData[channelData.length - lastSampleSize + i];
          }
          
          // Create audio source and play
          const source = audioContextPlaybackRef.current.createBufferSource();
          source.buffer = audioBuffer;
          
          // Create a gain node for volume control
          const gainNode = audioContextPlaybackRef.current.createGain();
          gainNode.gain.value = 0.9; // Slightly reduce volume to prevent clipping
          
          // Add a low-pass filter to smooth out high frequencies
          const lowPassFilter = audioContextPlaybackRef.current.createBiquadFilter();
          lowPassFilter.type = 'lowpass';
          lowPassFilter.frequency.value = 8000; // Cut off high frequencies
          
          // Connect nodes
          source.connect(lowPassFilter);
          lowPassFilter.connect(gainNode);
          gainNode.connect(audioContextPlaybackRef.current.destination);
          
          // Play the audio and chain to the next chunk when done
          source.onended = () => {
            setTimeout(() => playNextAudioChunk(), 5); // Reduce delay between chunks
          };
          
          source.start(0);
        } catch (pcmError) {
          console.error('Error playing PCM audio:', pcmError);
          setTimeout(() => playNextAudioChunk(), 10);
        }
      } 
    } catch (e) {
      console.error('Error in audio playback:', e);
      setTimeout(() => playNextAudioChunk(), 10);
    }
  };
  
  // 连接WebSocket
  const connectWebSocket = (explicitVoice?: VoiceType): Promise<boolean> => {
    return new Promise((resolve) => {
    try {
      // 使用当前页面的协议（HTTP或HTTPS）来确定WebSocket协议（WS或WSS）
      const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const protocol = isSecure ? 'wss:' : 'ws:';
      const host = process.env.NEXT_PUBLIC_API_BASE_URL || 'localhost:7002';
      
      // 构建WebSocket URL，确保使用正确的协议
      const wsBase = `${protocol}//${host.replace(/^https?:\/\//, '')}`;
      
      let wsUrl = `${wsBase}/ws/user-audio?token=${apiKey}&user_id=${userId}&client_id=${userId}`;
      
      const serverIds = mcpServerIds && mcpServerIds.length > 0 ? mcpServerIds.join(',') : '';
      if (serverIds.length > 0){
        wsUrl += `&mcp_server_ids=${serverIds}`;
      }
      
      // Use explicitly provided voice or fall back to state
      const currentVoice = explicitVoice || voiceType;
      // console.log(`Connecting with voice: ${currentVoice}`);
      
      // Add voice_id parameter to WebSocket URL
      wsUrl += `&voice_id=${currentVoice}`;
      
      console.log('Connecting to WebSocket URL:', wsUrl);
      
      websocketRef.current = new WebSocket(wsUrl);
      
      websocketRef.current.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        setStatus('WebSocket connected');
        setError(null);
        
        // Clear audio queue when connection is established
        audioQueueRef.current = [];
        
        // Resolve the promise with success
        resolve(true);
      };
      
      websocketRef.current.onmessage = (event) => {
        try {
          // Check if the message is binary (legacy audio data)
          if (event.data instanceof Blob) {
            setStatus('Received audio response');
            
            // Add to audio queue
            audioQueueRef.current.push(event.data);
            
            // Start playback if not already playing
            if (!isPlayingRef.current) {
              playNextAudioChunk();
            }
            return;
          }
          
          // Parse JSON message
          const jsonData = JSON.parse(event.data);
          
          // Handle PCM audio data
          if (jsonData.type === 'audio_data' && jsonData.format === 'pcm') {
            setStatus('Received audio');
            
            try {
              // Decode base64 data
              const binaryString = window.atob(jsonData.data);
              const len = binaryString.length;
              const bytes = new Uint8Array(len);
              
              // Convert binary string to byte array
              for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              
              // Create a PCM audio blob with metadata
              const pcmBlob = {
                audioData: bytes.buffer,
                sampleRate: jsonData.sampleRate,
                bitsPerSample: jsonData.bitsPerSample,
                channels: jsonData.channels
              };
              
              // Add to audio queue
              audioQueueRef.current.push(pcmBlob);
              
              // Start playback if not already playing
              if (!isPlayingRef.current) {
                playNextAudioChunk();
              }
              return;
            } catch (e) {
              console.error('Error processing PCM audio data:', e);
            }
          }
          
          // Handle toolUse data
          if (jsonData.type === 'toolUse') {
            console.log('Received toolUse data:', jsonData.data);
            setStatus('Processing tool use');
            
            if (onToolUse && jsonData.data) {
              // Call the onToolUse callback with the tool use data
              onToolUse(jsonData.data);
            }
            
            return;
          }
          
          // Handle toolResult data
          if (jsonData.type === 'toolResult') {
            console.log('Received toolResult data:', jsonData.data);
            setStatus('Received tool result');
            
            if (onToolResult && jsonData.data) {
              // Call the onToolResult callback with the tool result data
              onToolResult(jsonData.data);
            }
            
            return;
          }
          
          // Handle text messages
          if (jsonData.type === 'connection_established') {
            setStatus('Connection established');
          } else if (jsonData.type === 'ready') {
            setStatus('Nova Sonic ready');
          } else if (jsonData.type === 'text') {
            setStatus('Processing conversation');
            // If we have assistant text, show it and call the transcription callback
            if (onTranscription && jsonData.text && jsonData.text.assistant) {
              onTranscription(jsonData.text.assistant);
            }
            // Also show user text if available
            if (jsonData.text && jsonData.text.user) {
              setStatus(`User said: ${jsonData.text.user}`);
              // Add a flag to indicate this is a user message
              if (onTranscription) {
                onTranscription(jsonData.text.user, true);
              }
            }
          } else if (jsonData.type === 'error') {
            setError(jsonData.message || 'Unknown error');
            setStatus('Error occurred');
          }
        } catch (e) {
          console.error('Error processing WebSocket message:', e);
        }
      };
      
      websocketRef.current.onerror = (event) => {
        setError('WebSocket error');
        setIsConnected(false);
        setIsConnecting(false);
        setStatus('Connection error');
        
        // Resolve the promise with failure
        resolve(false);
      };
      
      websocketRef.current.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
        setStatus('Connection closed');
        
        // If the promise hasn't been resolved yet, resolve with failure
        resolve(false);
      };
    } catch (e) {
      setError(`Failed to connect: ${e}`);
      setStatus('Connection failed');
      setIsConnecting(false);
      
      // Resolve the promise with failure
      resolve(false);
    }
    
    // Return the promise
    return Promise.resolve(false);
  });
};
  
  // 断开WebSocket连接
  const disconnectWebSocket = () => {
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
      setIsConnected(false);
      setStatus('Disconnected');
      
      // Clear audio queue when disconnecting
      audioQueueRef.current = [];
      isPlayingRef.current = false;
    }
  };
  
  // 将音频数据转换为16位整数PCM
  const floatTo16BitPCM = (input: Float32Array): Int16Array => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      // 转换浮点值 (-1,1) 到 16位整数 (-32768,32767)
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  };
  
  const getAudioContext = (): AudioContext => {
    const AudioContextClass = window.AudioContext || 
      ((window as any).webkitAudioContext as typeof AudioContext);
    
    if (!AudioContextClass) {
      throw new Error('AudioContext not supported in this browser');
    }
    
    return new AudioContextClass({
      sampleRate: 44100 // 大多数设备原生采样率
    });
  };

  // 处理音频数据的函数
  const processAudioData = async (
    audioContext: AudioContext,
    inputData: Float32Array,
    websocket: WebSocket
  ) => {
    try {
      if (websocket.readyState !== WebSocket.OPEN) {
        return;
      }
      
      // 确定转换比例
      const targetSampleRate = 16000;
      const sourceSampleRate = audioContext.sampleRate;
      const ratio = targetSampleRate / sourceSampleRate;
      const targetLength = Math.round(inputData.length * ratio);
      
      // 创建离线上下文进行重采样
      const offlineContext = new OfflineAudioContext(
        1, // 单声道
        targetLength,
        targetSampleRate
      );
      
      // 创建缓冲区
      const resamplerBuffer = offlineContext.createBuffer(1, inputData.length, sourceSampleRate);
      const inputDataCopy = new Float32Array(inputData);
      resamplerBuffer.copyToChannel(inputDataCopy, 0);
      
      // 创建源节点
      const source = offlineContext.createBufferSource();
      source.buffer = resamplerBuffer;
      
      // 连接到目标节点并启动
      source.connect(offlineContext.destination);
      source.start(0);
      
      // 进行重采样
      const renderedBuffer = await offlineContext.startRendering();
      
      // 获取16kHz的PCM数据
      const resampledData = renderedBuffer.getChannelData(0);
      
      // 将Float32数组转换为Int16数组 (16位PCM)
      const pcmData = floatTo16BitPCM(resampledData);
      
      // 发送原始PCM数据
      websocket.send(pcmData.buffer);
    } catch (e) {
      console.error('Error processing audio:', e);
    }
  };

  // 创建音频处理器
  const createAudioProcessor = async (audioContext: AudioContext, stream: MediaStream) => {
    // 从麦克风创建音频源
    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = sourceNode;
    
    // 检查浏览器是否支持 AudioWorklet
    if (audioContext.audioWorklet) {
      try {
        // 创建一个 Blob URL 包含 AudioWorkletProcessor 代码
        const workletCode = `
          class AudioProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this.bufferSize = 4096;
              this.buffer = new Float32Array(this.bufferSize);
              this.bufferIndex = 0;
            }
            
            process(inputs, outputs, parameters) {
              const input = inputs[0][0];
              if (!input) return true;
              
              // 收集足够的样本后发送消息
              for (let i = 0; i < input.length; i++) {
                this.buffer[this.bufferIndex++] = input[i];
                
                if (this.bufferIndex >= this.bufferSize) {
                  // 发送完整的缓冲区
                  this.port.postMessage({
                    audioData: this.buffer.slice(0)
                  });
                  this.bufferIndex = 0;
                }
              }
              
              return true;
            }
          }
          
          registerProcessor('audio-processor', AudioProcessor);
        `;
        
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        
        // 注册 AudioWorklet 处理器
        await audioContext.audioWorklet.addModule(workletUrl);
        
        // 创建 AudioWorkletNode
        const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
        
        // 设置消息处理
        workletNode.port.onmessage = async (event) => {
          if (event.data.audioData && websocketRef.current) {
            await processAudioData(
              audioContext,
              event.data.audioData,
              websocketRef.current
            );
          }
        };
        
        // 连接节点
        sourceNode.connect(workletNode);
        workletNode.connect(audioContext.destination);
        
        // 保存引用
        processorNodeRef.current = workletNode;
        
        // 清理 Blob URL
        URL.revokeObjectURL(workletUrl);
        
        return workletNode;
      } catch (e) {
        console.warn('AudioWorklet failed, falling back to ScriptProcessor:', e);
        // 如果 AudioWorklet 失败，回退到 ScriptProcessor
        return createScriptProcessor(audioContext, sourceNode);
      }
    } else {
      // 回退到 ScriptProcessor
      return createScriptProcessor(audioContext, sourceNode);
    }
  };
  
  // 创建 ScriptProcessor 作为回退选项
  const createScriptProcessor = (audioContext: AudioContext, sourceNode: MediaStreamAudioSourceNode) => {
    // 使用 @ts-ignore 来忽略 TypeScript 警告
    // @ts-ignore - 使用已弃用的 ScriptProcessorNode 作为回退
    const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    
    // @ts-ignore - 使用已弃用的 onaudioprocess 事件作为回退
    processorNode.onaudioprocess = async (audioProcessingEvent: AudioProcessingEvent) => {
      if (websocketRef.current) {
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        await processAudioData(audioContext, inputData, websocketRef.current);
      }
    };
    
    // 连接节点
    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);
    
    return processorNode;
  };

  // 开始录音
  const startRecording = async () => {
    try {
      // Clear audio queue when starting recording
      audioQueueRef.current = [];

      // Check if mediaDevices API is available
      if (!navigator.mediaDevices) {
        // Fallback for older browsers or non-secure contexts
        throw new Error('MediaDevices API not available. This feature requires HTTPS. Please see HTTPS_SETUP.md for instructions on enabling HTTPS for local development.');
      }
      
      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // 连接WebSocket（如果尚未连接）
      if (!isConnected) {
        // 设置连接中状态
        setIsConnecting(true);
        setStatus('Setting up connection...');
        
        // 等待WebSocket连接建立 - explicitly pass current voice type
        const connected = await connectWebSocket(voiceType);
        
        // 如果连接失败，抛出错误
        if (!connected) {
          throw new Error('Failed to establish WebSocket connection');
        }
      }
      
      const audioContext = getAudioContext();
      audioContextRef.current = audioContext;
      
      // 创建并设置音频处理器
      await createAudioProcessor(audioContext, stream);
      
      setIsRecording(true);
      setStatus('Recording for Nova Sonic...');
    } catch (e) {
      setError(`Failed to start recording: ${e}`);
      setStatus('Recording failed');
    }
  };
  
  // 停止录音
  const stopRecording = () => {
    // 断开和清理AudioContext节点
    if (processorNodeRef.current && sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      processorNodeRef.current.disconnect();
    }
    
    // 关闭AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(e => console.error('Error closing AudioContext:', e));
      audioContextRef.current = null;
    }
    
    // 停止所有音频轨道
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    setIsRecording(false);
    setStatus('Recording stopped');
  };
  
  // 组件卸载时清理资源
  useEffect(() => {
    return () => {
      stopRecording();
      disconnectWebSocket();
      
      // Clean up audio playback resources
      if (audioContextPlaybackRef.current) {
        audioContextPlaybackRef.current.close().catch(e => 
          console.error('Error closing audio playback context:', e)
        );
        audioContextPlaybackRef.current = null;
      }
      
      // Clear audio queue
      audioQueueRef.current = [];
      isPlayingRef.current = false;
    };
  }, []);
  
  return (
    <div className="flex flex-col space-y-4 p-4 border rounded-lg bg-gray-50">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Nova Sonic Voice Chat</h3>
        <div className="flex items-center">
          <span className="text-xs mr-2">{isConnected ? 'Connected' : 'Disconnected'}</span>
          <div className={`h-3 w-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
        </div>
      </div>
      
      <div className={`text-sm px-3 py-2 rounded-md ${
        isRecording ? 'bg-red-100 text-red-700' :
        isConnecting ? 'bg-yellow-100 text-yellow-700' :
        'bg-gray-100 text-gray-700'
      }`}>
        {(isRecording || isConnecting) &&
          <span className="inline-block w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse"></span>
        }
        Status: {status}
      </div>
      
      {error && (
        <div className="text-sm text-red-500 bg-red-50 p-2 rounded-md">
          Error: {error}
        </div>
      )}
      
      <div className="flex flex-col space-y-2">
        <div className="mb-2">
          <label className="text-sm font-medium mb-1 block">Voice:</label>
          <div className="flex space-x-2">
            <VoiceOption
              id="matthew"
              label="Matthew"
              icon={<Mars className="h-4 w-4 text-blue-500" />}
              selected={voiceType === "matthew"}
              onClick={() => handleVoiceChange("matthew")}
              disabled={isRecording}
              key={`matthew-${voiceType === "matthew"}`}
            />
            <VoiceOption
              id="tiffany"
              label="Tiffany"
              icon={<Venus className="h-4 w-4 text-pink-500" />}
              selected={voiceType === "tiffany"}
              onClick={() => handleVoiceChange("tiffany")}
              disabled={isRecording}
              key={`tiffany-${voiceType === "tiffany"}`}
            />
            <VoiceOption
              id="amy"
              label="Amy"
              icon={<Venus className="h-4 w-4 text-purple-500" />}
              selected={voiceType === "amy"}
              onClick={() => handleVoiceChange("amy")}
              disabled={isRecording}
              key={`amy-${voiceType === "amy"}`}
            />
          </div>
        </div>
        
        <div className="flex space-x-2">
          {!isRecording ? (
            <Button
              onClick={startRecording}
              disabled={isRecording || isConnecting}
              className="bg-blue-500 hover:bg-blue-600 flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
              Start
            </Button>
          ) : (
            <Button
              onClick={stopRecording}
              className="bg-red-500 hover:bg-red-600 flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
              </svg>
              Stop
            </Button>
          )}
          
          {isConnected && (
            <Button
              onClick={disconnectWebSocket}
              variant="outline"
              className="flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 6a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 6a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
              Disconnect
            </Button>
          )}
        </div>
      </div>
      
      {/* Helpful tip for users */}
      <div className="text-xs text-gray-500 italic">
        Tip: Click "Start" and speak. Nova Sonic will process your speech in real-time and respond with both text and voice.
      </div>
    </div>
  );
};

// Voice option component
interface VoiceOptionProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const VoiceOption: React.FC<VoiceOptionProps> = ({
  id,
  label,
  icon,
  selected,
  onClick,
  disabled = false
}) => {
  return (
    <button
      id={`voice-${id}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center px-3 py-2 rounded-md transition-colors
        ${selected
          ? 'bg-blue-100 border border-blue-300 text-blue-700'
          : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span className="mr-2">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
};

// 添加TypeScript接口定义
interface Window {
  AudioContext: typeof AudioContext;
  webkitAudioContext: typeof AudioContext;
}

export default AudioRecorder;
