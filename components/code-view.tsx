import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeViewProps {
  code: string;
  language?: string;
}

export function CodeView({ code, language = 'javascript' }: CodeViewProps) {
  return (
    <div className="max-h-full rounded-md">
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          padding: '1rem',
          fontSize: '0.875rem',
          borderRadius: '0.375rem',
        }}
        wrapLines={true}
        wrapLongLines={true}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
