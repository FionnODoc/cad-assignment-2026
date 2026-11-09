import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, type QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import {
  ddb,
  isMovieItem,
  isRoleItem,
  movieKey,
  parseId,
  tableName,
  toRole,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

// GET /movies/{movieID}/roles?[actor=actorID]
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: "movieID must be a positive integer" });
  }

  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: "actor must be a positive integer" });
  }

  try {
    // The movie item and its role items share the partition key m#movieID.
    const items: Record<string, unknown>[] = [];
    let lastKey: QueryCommandOutput["LastEvaluatedKey"];
    do {
      const queryResult = await ddb.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": movieKey(movieId) },
          ExclusiveStartKey: lastKey,
        })
      );
      items.push(...(queryResult.Items ?? []));
      lastKey = queryResult.LastEvaluatedKey;
    } while (lastKey);

    if (!items.some(isMovieItem)) {
      return response(404, { message: `Movie ${movieId} not found` });
    }

    const roles = items.filter(isRoleItem).map(toRole);
    if (actorId === undefined) {
      return response(200, { data: roles });
    }

    const actorRole = roles.find((role) => role.actorId === actorId);
    if (!actorRole) {
      return response(404, {
        message: `Actor ${actorId} has no role in movie ${movieId}`,
      });
    }
    return response(200, { data: actorRole });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};
