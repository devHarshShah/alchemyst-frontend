import { SignupForm } from "@/components/signup-form"

export default function SignupPage() {
  return (
    <div className="bg-muted flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <SignupForm />
      </div>
    </div>
  )
}
