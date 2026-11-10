import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { actorKey, ddb, movieKey, type Role, tableName } from "../shared/db";
import { isResponse, parseJsonObject, response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

// Returns the validated role, or a 400 response listing the invalid fields.
const parseRole = (body: Record<string, unknown>): Role | APIGatewayProxyResult => {
  const invalid = [
    ...(["movieId", "actorId"] as const).filter((f) => !isPositiveInteger(body[f])),
    ...(["roleName", "roleDescription"] as const).filter((f) => !isNonEmptyString(body[f])),
  ];
  if (invalid.length) {
    return response(400, { message: `Missing or invalid fields: ${invalid.join(", ")}` });
  }
  return {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: (body.roleName as string).trim(),
    roleDescription: (body.roleDescription as string).trim(),
  };
};

// POST /movies/roles  { movieId, actorId, roleName, roleDescription }
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const body = parseJsonObject(event);
  if (isResponse(body)) return body;
  const role = parseRole(body);
  if (isResponse(role)) return role;

  const movie = movieKey(role.movieId);
  const actor = actorKey(role.actorId);
  try {
    // One transaction: the movie and actor must exist, and the role must be new.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: movie, SK: movie },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: actor, SK: actor },
              ConditionExpression: "attribute_exists(PK)",
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: { PK: movie, SK: actor, ...role },
              ConditionExpression: "attribute_not_exists(PK)",
            },
          },
        ],
      })
    );
    return response(201, { message: "Role added", data: role });
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      // CancellationReasons are in the same order as TransactItems.
      const [movieCheck, actorCheck, rolePut] = (err.CancellationReasons ?? []).map(
        (reason) => reason.Code === "ConditionalCheckFailed"
      );
      if (movieCheck) return response(404, { message: `Movie ${role.movieId} not found` });
      if (actorCheck) return response(404, { message: `Actor ${role.actorId} not found` });
      if (rolePut) {
        return response(409, {
          message: `Actor ${role.actorId} already has a role in movie ${role.movieId}`,
        });
      }
    }
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};
