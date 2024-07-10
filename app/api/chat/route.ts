import { z } from 'zod'
import {
  type CoreMessage,
  type ImagePart,
  type TextPart,
  type UserContent,
  StreamingTextResponse,
  StreamData,
  streamText,
  tool
} from 'ai'
// import { anthropic } from '@ai-sdk/anthropic'
import { bedrock,createAmazonBedrock} from '@ai-sdk/amazon-bedrock';
import {
  runPython,
  runJs
} from '@/lib/local-sandbox'
import {type FileData} from '@/components/chat';

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 获取上两级目录的路径
const twoLevelsUp = path.resolve(__dirname, '..', '..','..');

export interface ServerMessage {
  role: 'user' | 'assistant' | 'function';
  content: string;
}

interface ToolResult<NAME extends string, ARGS, RESULT> {
  /**
ID of the tool call. This ID is used to match the tool call with the tool result.
 */
  toolCallId: string;
  /**
Name of the tool that was called.
 */
  toolName: NAME;
  /**
Arguments of the tool call. This is a JSON-serializable object that matches the tool's input schema.
   */
  args: ARGS;
  /**
Result of the tool call. This is the result of the tool's execution.
   */
  result: RESULT;
}

type initMessages ={
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: Array<ToolResult<string, unknown, unknown>>;
};

function saveCSVToFile(fileData: FileData, outputDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileName = `${fileData.name}`;
    const filePath = path.join(outputDir, fileName);

    fs.writeFile(filePath, fileData.content, 'utf8', (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`save file:${filePath}`)
        resolve(filePath);
      }
    });
  });
}

function saveXLSXToFile(fileData: FileData, outputDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Convert base64 to binary
    const binaryData = Buffer.from(fileData.content, 'base64');
    const fileName = `${fileData.name}`;
    const filePath = path.join(outputDir, fileName);
    // Write the file
    fs.writeFile(filePath, binaryData, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`save file:${filePath}`)
        resolve(filePath);
      }
    });
  });
}


export async function POST(req: Request) {

  const { messages, userID, data }: { messages: CoreMessage[], userID: string, data:string } = await req.json()

  //workingDirPath = app/workingdir/{userID}
  const workingDirPath = path.join(twoLevelsUp,'workingdir', userID);

  if (!fs.existsSync(workingDirPath)) {
    fs.mkdirSync(workingDirPath, { recursive: true });
  }
  let llmModel;
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY){
    console.log('using bedrock client specified from env')
    llmModel = bedrock(process.env.MODEL_ID || 'anthropic.claude-3-5-sonnet-20240620-v1:0');
  }else{ 
    console.log('using default bedrock client')
    //use default credentials from the ec2 role or aws credentials
    const bedrockClient = new createAmazonBedrock({bedrockOptions:{
      region: 'us-east-1',
    }});
    llmModel = bedrockClient(process.env.MODEL_ID || 'anthropic.claude-3-5-sonnet-20240620-v1:0');
  }

  const initialMessagesDraft = messages.slice(0, -1) as CoreMessage [];

  //to workround the issue that the content is empty
  const initialMessages = initialMessagesDraft.map((it) => ({
    ...it,
    content: it.content||'## Result:',
  }));

  const currentMessage = messages[messages.length - 1];
  const fileData =  data?JSON.parse(data):null;
  let imageData : string []= [];
  let textFileName : string []= [];
  if (fileData&& fileData.length> 0) {
    fileData.map(async (it:FileData) => {
      if (it.type === 'image') {
        imageData.push(it.content);
      }else if (it.type === 'csv') {
        textFileName.push(it.name);
        const savedFilePath = await saveCSVToFile(it, workingDirPath);
        console.log(`CSV file saved to: ${savedFilePath}`);
      }else if (it.type === 'xlsx') {
        textFileName.push(it.name);
        const savedFilePath = await saveXLSXToFile(it, workingDirPath);
        console.log(`XLSX file saved to: ${savedFilePath}`);
      } else if (it.type !== 'text') {
        console.log(`${it.type} not supported yet`)
      }
    })
  }
  const fileMessages = imageData.length>0? 
                    (imageData as []).map(it => ({ type: 'image', image: it})) as ImagePart[]:
                    (textFileName.length>0 ? textFileName.map(it => ({ type: 'text', text: `Here is user's uploaded file name:${it}`})) as TextPart[]:[])
  
  let userContent;
  let newMessages;
  if (currentMessage.role === 'user'){
    userContent = [
      { type: 'text', text: currentMessage.content as string },
      ...fileMessages
    ]
    newMessages =[
      ...initialMessages,
      {
        role: 'user',
        content: userContent as UserContent,
      },
    ];
  }else{
    newMessages = messages;
  }


  //only pass the last two messages
  newMessages = newMessages.slice(-3)

  console.log('newMessages:',newMessages)

  // console.log(newMessages)
  let streamData: StreamData = new StreamData()

  const result = await streamText({
    model: llmModel,
    temperature:0,
    tools: {
      runPython: tool({
        description: 'Runs Python code. such as data analysis, data exploration, math,etc',
        parameters: z.object({
          title: z.string().describe('Short title (5 words max) of the artifact.'),
          description: z.string().describe('Short description (10 words max) of the artifact.'),
          code: z.string().describe('The code to run in its own context'),
        }),
        async execute({ code }) {
          streamData.append({
            tool: 'runPython',
            state: 'running',
          })
          const execOutput = await runPython(userID, code)
          const stdout = execOutput.logs.stdout
          const stderr = execOutput.logs.stderr
          const runtimeError = execOutput.error
          const results = execOutput.results
          console.log(`stdout:${stdout}`);
          streamData.append({
            tool: 'runPython',
            stdout:stdout,
            state: 'complete',
          })
          return {
            stdout,
            stderr,
            runtimeError,
            cellResults: results,
          }
        },
      }),
      runJs: tool({
        description: 'Runs HTML or Javascript code.',
        parameters: z.object({
          title: z.string().describe('Short title (5 words max) of the artifact.'),
          description: z.string().describe('Short description (10 words max) of the artifact.'),
          code: z.string().describe('The code to run. can be a html and js code'),
        }),
        async execute({ code }) {
          // console.log(code)
          streamData.append({
            tool: 'runJs',
            state: 'running',
          })
          const execOutput = await runJs(userID, code)
          const stdout = execOutput.logs.stdout
          const stderr = execOutput.logs.stderr
          const runtimeError = execOutput.error
          const results = execOutput.results

          streamData.append({
            tool: 'runJs',
            stdout:stdout,
            state: 'complete',
          })
          // console.log(data)
          return {
            stdout,
            stderr,
            runtimeError,
            cellResults: results,
          }
        },
      }),
    },
    toolChoice: 'auto',
    system: `
    You are a skilled Python and Javascript developer.
    You are also expert of data science and data analysis, and you are also expert of solution architecture of AWS, Google Cloud, Azure, etc.
    You are very familiar with the following tools and libraries:
    For Python:
    <python_libraries>
    pandas, numpy, matplotlib, seaborn, scikit-learn, diagrams, etc.
    </python_libraries>

    For JavaScript:
    <js_libraries>
    d3, react, canvas, threejs, cannonjs, etc.
    </js_libraries>

    You have the ability to choose the appropriate tools and run Python or JavaScript code to solve the user's task. Code for each programming language runs in its own context and can reference previous definitions and variables.
    Your code will be run in a seperate sandbox, so you don't write the code that contains code to read the data or file locally.
    `,
    messages:newMessages as CoreMessage[],
  })

  const stream = result.toAIStream({
    async onFinal() {
      await streamData.close()
    }
  })

  return new StreamingTextResponse(stream, {}, streamData);
}
