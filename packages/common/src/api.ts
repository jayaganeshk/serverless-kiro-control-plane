// ─── API Response Envelope ───

export interface PaginationInfo {
  nextToken: string | null;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  pagination?: PaginationInfo;
  error?: ApiError;
}
