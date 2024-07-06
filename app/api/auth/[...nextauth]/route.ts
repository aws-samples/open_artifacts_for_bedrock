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
        // Add your own logic here to validate credentials
        const user = process.env.USERNAME??'admin';
        const password = process.env.PASSWORD??'admin';
        if (credentials?.username === user && credentials?.password === password) {
          return { id: "1", name: user, email: "user@example.com" }
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
