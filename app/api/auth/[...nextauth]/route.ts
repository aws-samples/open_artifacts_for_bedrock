import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, req) {
        // 获取环境变量中的用户名和密码列表
        const usernames = (process.env.USERNAME ?? 'admin').split(',');
        const passwords = (process.env.PASSWORD ?? 'admin').split(',');

         // 检查提供的凭证是否匹配任何用户名和密码对
         const isValidCredentials = usernames.some((username, index) => 
          credentials?.username === username.trim() && 
          credentials?.password === passwords[index].trim()
        );

        if (isValidCredentials) {
          return { id: "1", name: credentials?.username, email: `${credentials?.username}@example.com` }
        } else {
          return null
        }
      }
    })
  ],
  pages: {
    signIn: '/login',
  },
})

export { handler as GET, handler as POST }
