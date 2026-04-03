/** Thrown when a DynamoDB conditional write fails (ConditionalCheckFailedException). */
export class ConflictError extends Error {
  public readonly code: string;

  constructor(message: string, code = "CONFLICT") {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}
