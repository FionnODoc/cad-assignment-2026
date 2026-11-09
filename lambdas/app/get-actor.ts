import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  actorKey,
  ddb,
  movieKey,
  parseId,
  tableName,
  toActor,
} from "../shared/db";
import { response } from "../shared/http";
import { logRequest } from "../shared/request-logger";

const getItem = async (PK: string, SK: string) =>
  (await ddb.send(new GetCommand({ TableName: tableName, Key: { PK, SK } }))).Item;

// GET /actors/{actorID}?[movie=movieID]
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const actorId = parseId(event.pathParameters?.actorID);
  if (actorId === undefined) {
    return response(400, { message: "actorID must be a positive integer" });
  }

  const movieParam = event.queryStringParameters?.movie;
  const movieId = parseId(movieParam);
  if (movieParam !== undefined && movieId === undefined) {
    return response(400, { message: "movie must be a positive integer" });
  }
  try {
    const actorItem = await getItem(actorKey(actorId), actorKey(actorId));
    if (!actorItem) {
      return response(404, { message: `Actor ${actorId} not found` });
    }
    const actor = toActor(actorItem);
    if (movieId === undefined) {
      return response(200, { data: actor });
    }

    const [movieItem, roleItem] = await Promise.all([
      getItem(movieKey(movieId), movieKey(movieId)),
      getItem(movieKey(movieId), actorKey(actorId)),
    ]);
    if (!movieItem) {
      return response(404, { message: `Movie ${movieId} not found` });
    }
    // The role description is only included when the actor is in the movie.
    return response(200, {
      data: roleItem
        ? { ...actor, roleDescription: roleItem.roleDescription as string }
        : actor,
    });
  } catch (err) {
    console.error("DynamoDB error:", err);
    return response(500, { message: "Internal server error" });
  }
};
