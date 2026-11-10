import type { APIGatewayProxyEvent } from 'aws-lambda';

// Logs "<requester>   <request path>[?query]" to CloudWatch, e.g.
//   doconnor   /actors/4321?movie=1234
// The requester is the Cognito username, which the authorizer lambda puts in the
// request context, or "admin" for requests made with the administrator API key.
export const logRequest = (event: APIGatewayProxyEvent): void => {
  const username =
    event.requestContext.authorizer?.username ??
    (event.requestContext.identity?.apiKeyId ? 'admin' : 'anonymous');
  const params = Object.entries(event.queryStringParameters ?? {}).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const query = params.length ? `?${new URLSearchParams(params)}` : '';
  console.log(`${username}   ${event.path}${query}`);
};
