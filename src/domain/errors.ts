/** A rule of the domain was broken by the request; `status` is the HTTP status the API layer responds with. */
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
