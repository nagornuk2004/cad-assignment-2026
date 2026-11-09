import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { actorKey, ddb, isRoleItem, movieKey, parseId, tableName, toRole } from '../shared/db';
import { response } from '../shared/http';
import { logRequest } from '../shared/request-logger';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const movieId = parseId(event.pathParameters?.movieID);
  if (movieId === undefined) {
    return response(400, { message: 'movieID must be a positive integer' });
  }

  const actorParam = event.queryStringParameters?.actor;
  const actorId = parseId(actorParam);
  if (actorParam !== undefined && actorId === undefined) {
    return response(400, { message: 'actorID must be a positive integer' });
  }

  try {
    const queryResult = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: actorId !== undefined ? 'PK = :pk AND SK = :sk' : 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': movieKey(movieId),
          ...(actorId !== undefined && { ':sk': actorKey(actorId) }),
        },
      }),
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      const message =
        actorId !== undefined
          ? `Role with actor ${actorId} in movie ${movieId} not found`
          : `Movie ${movieId} not found`;
      return response(404, { message });
    }

    const resultItems = queryResult.Items;
    return response(200, { data: resultItems.filter(isRoleItem).map(toRole) });
  } catch (err) {
    console.error('DynamoDB error:', err);
    return response(500, { message: 'Internal server error' });
  }
};
