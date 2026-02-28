export interface AuthCredentials {
  email: string
  password: string
}

export interface AuthUser {
  id: string
  email: string
}

export interface AuthMeResponse {
  statusCode: number
  message: string
  data: AuthUser
}

export interface AuthPayload {
  token: string
  user: AuthUser
}

export interface AuthSuccessResponse {
  statusCode: number
  message: string
  data: AuthPayload
}

interface ApiErrorResponse {
  statusCode?: number
  message?: string
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isAuthUser = (value: unknown): value is AuthUser =>
  isObject(value) &&
  typeof value.id === "string" &&
  typeof value.email === "string"

const isAuthSuccessResponse = (value: unknown): value is AuthSuccessResponse =>
  isObject(value) &&
  typeof value.statusCode === "number" &&
  typeof value.message === "string" &&
  isObject(value.data) &&
  typeof value.data.token === "string" &&
  isAuthUser(value.data.user)

const isAuthMeResponse = (value: unknown): value is AuthMeResponse =>
  isObject(value) &&
  typeof value.statusCode === "number" &&
  typeof value.message === "string" &&
  isAuthUser(value.data)

const getApiErrorMessage = (value: unknown, fallback: string): string => {
  if (!isObject(value)) {
    return fallback
  }

  const apiError = value as ApiErrorResponse
  if (typeof apiError.message === "string" && apiError.message.trim().length > 0) {
    return apiError.message
  }

  return fallback
}

const authRequest = async (
  endpoint: "/auth/login" | "/auth/signup",
  credentials: AuthCredentials
): Promise<AuthSuccessResponse> => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(credentials),
  })

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(payload, `Request failed with status ${response.status}`)
    )
  }

  if (!isAuthSuccessResponse(payload)) {
    throw new Error("Unexpected response from auth API")
  }

  return payload
}

export const login = (credentials: AuthCredentials): Promise<AuthSuccessResponse> =>
  authRequest("/auth/login", credentials)

export const signup = (credentials: AuthCredentials): Promise<AuthSuccessResponse> =>
  authRequest("/auth/signup", credentials)

const getAuthHeaders = (token?: string): HeadersInit => {
  if (!token) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

export const getCurrentUser = async (token?: string): Promise<AuthUser> => {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    method: "GET",
    headers: getAuthHeaders(token),
    credentials: "include",
  })

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(payload, `Request failed with status ${response.status}`)
    )
  }

  if (!isAuthMeResponse(payload)) {
    throw new Error("Unexpected response from user API")
  }

  return payload.data
}
