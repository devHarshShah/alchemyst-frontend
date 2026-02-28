import { LoginForm } from "@/components/login-form"

export default function LoginPage() {
  return (
    <div className="bg-muted flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  )
}
