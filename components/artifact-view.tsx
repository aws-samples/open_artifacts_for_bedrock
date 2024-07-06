import { type ExecutionError, Result } from '@e2b/code-interpreter'
import Image from 'next/image'
import { Terminal } from 'lucide-react'

import {
  Alert,
  AlertTitle,
  AlertDescription,
} from '@/components/ui/alert'

function LogsOutput({ stdout, stderr }: {
  stdout: string[]
  stderr: string[]
}) {
  if (stdout.length === 0 && stderr.length === 0) return null

  return (
    <div className="w-full h-128 max-h-128 overflow-y-auto flex flex-col items-start justify-start space-y-1 p-4 bg-[#F5F5F5] rounded">
      {stdout && stdout.length > 0 && stdout.map((out: string, index: number) => (
        <pre key={index} className="text-xs">
          {out}
        </pre>
      ))}
      {stderr && stderr.length > 0 && stderr.map((err: string, index: number) => (
        <pre key={index} className="text-xs text-red-500">
          {err}
        </pre>
      ))}
    </div>
  )
}



export interface CodeExecResult {
  stdout: string[]
  stderr: string[]
  runtimeError?: ExecutionError
  cellResults: Result[]
}

export function ArtifactView({
  result,
}: {
  result?: CodeExecResult
}) {
  // console.log('ArtifactView.result', result);
  if (!result) return null
 
  const { cellResults, stdout, stderr, runtimeError } = result
  // The AI-generated code experienced runtime error
  if (runtimeError) {
    const { name, value, tracebackRaw } = runtimeError
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <Terminal className="h-4 w-4"/>
          <AlertTitle>{name}: {value}</AlertTitle>
          <AlertDescription className="font-mono whitespace-pre-wrap">
            {tracebackRaw}
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // Cell results can contain text, pdfs, images, and code (html, latex, json)
  // TODO: Check other formats than `png`
  if (cellResults.length > 0) {
    if (cellResults[0].png){
      return (
        <>
          <div className="w-full flex-1 p-4 flex flex-col items-center justify-start space-y-4">
            {cellResults.map((result, index) => (
              <Image
              key={index}
              src={`data:image/png;base64,${result.png}`}
              alt="result"
              width={800}
              height={400}
            />

            ))}
          </div>
          <LogsOutput stdout={stdout} stderr={stderr} />
        </>
      )
    }else if (cellResults[0].html){
      // console.log('ArtifactView.cellResults', cellResults);
      return( 
        // <div className="w-full flex-1 p-4 flex items-start justify-center">
          <iframe
          srcDoc={cellResults[0].html}
          width="100%"
          height="100%"
          sandbox="allow-same-origin allow-scripts"
        /> 
        //  </div>
      )
    }

  }

  // No cell results, but there is stdout or stderr
  if (stdout.length > 0 || stderr.length > 0) {
    return (
      <LogsOutput stdout={stdout} stderr={stderr} />
    )
  }
  return (
    <span>No output or logs</span>
  )
}