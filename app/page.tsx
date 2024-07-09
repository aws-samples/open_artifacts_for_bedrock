'use client'

import { useEffect } from 'react'
import { useSession,signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useChat } from 'ai/react'
import type {
  Message,
} from '@ai-sdk/ui-utils';
import { Chat } from '@/components/chat'
import { SideView } from '@/components/side-view'
import { LogOut } from 'lucide-react'

export default function Home() {
  const { data: session, status } = useSession()
  const router = useRouter()
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
    }
  }, [status, router])
  const handleLogout = async () => {
    await signOut({ callbackUrl: '/login' })
  }
  const userID = session?.user?.name || 'default-user-id'

  const { messages, setMessages, reload, input,isLoading, setInput, append, handleInputChange, handleSubmit, data } = useChat({
    api: '/api/chat',
    body: { userID },
    onResponse: (response: Response) => {
      console.log('Received response from server:', response)
    },
    onFinish: (message: Message) => {
      console.log('Finished streaming message:', message)
    },

  })

  // For simplicity, we care only about the latest message that has a tool invocation
  const latestMessageWithToolInvocation = [...messages].reverse().find(message => message.toolInvocations && message.toolInvocations.length > 0)
  // Get the latest tool invocation
  const latestToolInvocation = latestMessageWithToolInvocation?.toolInvocations?.[0]

  const clearMessages = () => {
    setMessages([]);
  };

  if (status === 'loading') {
    return <div>Loading...</div>
  }

  if (!session) {
    return null
  }

  return (
    <main className="flex min-h-screen max-h-screen">
      <div className="fixed top-0 left-0 right-0 py-4 pl-8">
        <Image src="/logo.svg" alt="logo" width={32} height={32} />
      </div>
      <button
        onClick={handleLogout}
        className="absolute top-4 right-8 p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center"
      >
        <LogOut size={18} className="mr-2" />
        Logout
      </button>
      <div className="flex-1 flex space-x-8 w-full pt-16 pb-8 px-4">
        <Chat
          data ={data}
          messages={messages}
          append={append}
          isLoading={isLoading}
          input={input}
          handleInputChange={handleInputChange}
          handleSubmit={handleSubmit}
          reload={reload}
          setInput={setInput}
          clearMessages={clearMessages}
        />
        <SideView toolInvocation={latestToolInvocation} data={data} />
      </div>
    </main>
  )
}
