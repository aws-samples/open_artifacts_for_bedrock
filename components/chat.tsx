import { useState, useEffect, FormEvent, useCallback, useRef } from 'react'
import { Terminal, Image as ImageIcon ,Paperclip,Trash2,FileText, FileSpreadsheet, FileUp,RefreshCw,CircleX} from 'lucide-react'
import { Message } from 'ai/react'
import type {
  ChatRequestOptions,
  UseChatOptions,
} from '@ai-sdk/ui-utils';
import { Input } from '@/components/ui/input'
import { JSONValue } from 'ai';

export interface FileData {
  id: string;
  type: 'image' | 'text' | 'csv'| 'xlsx';
  content: string;
  name: string;
}

export function Chat({
  data,
  messages,
  input,
  append,
  handleInputChange,
  handleSubmit,
  reload,
  isLoading,
  setInput,
  clearMessages,
  stop,
}: {
  data: JSONValue[] | undefined,
  messages: Message[],
  input: string,
  append: (e: any, options: ChatRequestOptions) => any,
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void,
  reload: (chatRequestOptions?: ChatRequestOptions | undefined) => Promise<string | null | undefined>,
  isLoading:boolean,
  setInput: (e: any) => void,
  clearMessages: () => void,
  stop:()=> void,
}) {
  const [files, setFiles] = useState<FileData[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // console.log('messages', messages);
  const latestMessageWithToolInvocation = [...messages].reverse().find(message => message.toolInvocations && message.toolInvocations.length > 0)
  const latestToolInvocation = latestMessageWithToolInvocation?.toolInvocations?.[0]
  const code = latestToolInvocation ? latestToolInvocation.args.code : undefined;
  // get the last element of data

  const exeResult = data?.length && data.slice(-1)[0]?.state === 'complete' ? data.slice(-1)[0]?.stdout:'';
  // console.log('data:',data)
  // console.log('latestToolInvocation:',latestToolInvocation)

  const customSubmit = useCallback(
    (event?: { preventDefault?: () => void },
      options: ChatRequestOptions = {},
    ) => {
      event?.preventDefault?.();
      if (!input && files.length === 0) return;

      //since AI SDK for Claude does't support tool content
      //so I modify the last user message to include the tool invocation results
      const content = code ? `## code:\n${code} \n\n## tool executed result:\n${exeResult} \n\nHuman:\n${input}` : input;
      append({
        content,
        role: 'user',
        data:options?.data  as string,
        createdAt: new Date(),
        },
        options
      );

      setInput('');
      setFiles([]);
    },
    [input, append],
  );

  const processFile = (file: File): Promise<FileData> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const result = e.target?.result as string;
        let type: 'image' | 'text' | 'csv' | 'xlsx';
        let content = result;
        if (file.type.startsWith('image/')) {
          type = 'image';
        } else if (file.name.endsWith('.csv')) {
          type = 'csv';  
        } else if (file.name.endsWith('.xlsx')) {
          type = 'xlsx';    
           // Convert ArrayBuffer to Base64 string
          const uint8Array = new Uint8Array((result as any ) as ArrayBuffer);
          const binaryString = uint8Array.reduce((data, byte) => data + String.fromCharCode(byte), '');
          content = btoa(binaryString);
          // console.log(content)
        } else {
          type = 'text';
        }
        resolve({
          id: Date.now().toString(),
          type,
          content: content,
          name: file.name
        });
      };
      reader.onerror = reject;

      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
      }else if (file.name.endsWith('.xlsx')) {
        reader.readAsArrayBuffer(file);
      }else {
        reader.readAsText(file);
      }
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles) {
      const processedFiles = await Promise.all(Array.from(selectedFiles).map(processFile));
      setFiles(prev => [...prev, ...processedFiles]);
    }
  };

  const handlePaste = async (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            const processedFile = await processFile(file);
            setFiles(prev => [...prev, processedFile]);
          }
        }
      }
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(file => file.id !== id));
  };

  const renderFilePreview = (file: FileData) => {
    switch (file.type) {
      case 'image':
        return <img src={file.content} alt={file.name} className="w-full h-full object-cover rounded" />;
      case 'text':
        return <FileText className="w-full h-full text-gray-600" />;
      case 'csv':
        return <FileSpreadsheet className="w-full h-full text-green-600" />;
      case 'xlsx':
          return <FileSpreadsheet className="w-full h-full text-green-600" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col py-4 gap-4 max-h-full max-w-[800px] mx-auto justify-between">
      <div className="flex flex-col gap-2 overflow-y-auto max-h-full px-4 rounded-lg">
        {messages.map(message => (
          <div className={`py-2 px-4 shadow-sm whitespace-pre-wrap ${message.role !== 'user' ? 'bg-white' : 'bg-white/40'} rounded-lg border-b border-[#FFE7CC] font-serif`} key={message.id}>
            {message.content}
            {message.data && ( JSON.parse(message.data as string).map( (fileData:FileData, index:number) => (
              <div key={index} className="mt-4 flex justify-start items-start border border-[#FFE7CC] rounded-md">
               {fileData.type === 'image' ? (
                  <img
                    src={fileData.content}
                    alt="Uploaded"
                    className="mt-2 max-w-full h-auto rounded"
                  />
                ) : (
                  <div className="p-2">
                    <p>{fileData.name}</p>
                    <p>{fileData.type === 'csv' ? 'CSV file' : (fileData.type === 'xlsx' ? 'XLSX file': 'Text file')}</p>
                  </div>
                )}
              </div>
              ))
            )}  
            {message.toolInvocations && message.toolInvocations.length > 0 &&
              <div className="mt-4 flex justify-start items-start border border-[#FFE7CC] rounded-md">
                <div className="p-2 self-stretch border-r border-[#FFE7CC] bg-[#FFE7CC] w-14 flex items-center justify-center">
                  <Terminal strokeWidth={2} className="text-[#FF8800]" />
                </div>
                <div className="p-2 flex flex-col space-y-1 justify-start items-start min-w-[100px]">
                  {(message.toolInvocations[0].toolName === "runPython" || message.toolInvocations[0].toolName === "runJs") &&
                    <>
                      <span className="font-bold font-sans text-sm">{message.toolInvocations[0].args.title}</span>
                      <span className="font-sans text-sm">{message.toolInvocations[0].args.description}</span>
                    </>
                  }
                </div>
              </div>
            }
          </div>
        ))}
      </div>

      <form onSubmit={e => {
        customSubmit(e, {
          data: files.length ? JSON.stringify(files) : undefined
        })
      }}
        className="flex flex-col gap-6">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((file,index) => (
              <div key={index} className="relative w-24 h-24">
                 {renderFilePreview(file)}...{file.name.slice(-12)}
                <button
                  type="button"
                  onClick={() => removeFile(file.id)}
                  className="absolute top-0 right-0 bg-red-500 text-white rounded-full p-1"
                >
                  X
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={(e)=>{ 
              clearMessages()
              setFiles([])}
            }
            className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            <Trash2 size={24} />
          </button>
          <Input
            className="ring-0 flex-grow"
            placeholder="Ask Claude..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handlePaste}
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            <FileUp size={24} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*,text/*,.csv,.xlsx"
            multiple
            className="hidden"
          />
            <button
            type="button"
            onClick={reload} 
            disabled={isLoading}
            className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            <RefreshCw size={24} />
          </button>
          {isLoading && (
            <button
             type="button" onClick={() => stop()}
             className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
             >
              <CircleX size={24} />
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
