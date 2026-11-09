import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { TransactWriteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { actorKey, ddb, movieKey, type Role, tableName } from '../shared/db';
import { isResponse, parseJsonObject, response } from '../shared/http';
import { logRequest } from '../shared/request-logger';
import Ajv from 'ajv';
import schema from '../../shared/types.schema.json';

const ajv = new Ajv();
const isValidRolePayload = ajv.compile<Role>(schema.definitions['Role']);

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logRequest(event);

  const body = parseJsonObject(event);
  if (isResponse(body)) return body;

  if (!isValidRolePayload(body)) {
    return response(400, {
      message: 'Incorrect type. Must match the Role schema',
      schema: schema.definitions['Role'],
    });
  }

  const role: Role = {
    movieId: body.movieId as number,
    actorId: body.actorId as number,
    roleName: body.roleName as string,
    roleDescription: body.roleDescription as string,
  };

  if (role.movieId <= 0) {
    return response(400, { message: 'movieID must be a positive integer' });
  }

  if (role.actorId <= 0) {
    return response(400, { message: 'actorID must be a positive integer' });
  }

  try {
    const roleResult = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: movieKey(role.movieId), SK: actorKey(role.actorId) },
      }),
    );
    if (roleResult.Item) {
      return response(409, {
        message: `Role with actor ${role.actorId} in movie ${role.movieId} already exists`,
      });
    }
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: movieKey(role.movieId), SK: movieKey(role.movieId) },
              ConditionExpression: 'attribute_exists(PK)',
            },
          },
          {
            ConditionCheck: {
              TableName: tableName,
              Key: { PK: actorKey(role.actorId), SK: actorKey(role.actorId) },
              ConditionExpression: 'attribute_exists(PK)',
            },
          },
          {
            Put: {
              TableName: tableName,
              Item: {
                ...role,
                PK: movieKey(role.movieId),
                SK: actorKey(role.actorId),
              },
            },
          },
        ],
      }),
    );
    return response(201, { message: 'Role added', data: role });
  } catch (err: any) {
    if (err.name === 'TransactionCanceledException') {
      return response(404, {
        message: 'Movie or actor with provided ID not found',
      });
    }
    console.error('DynamoDB error:', err);
    return response(500, { message: 'Internal server error' });
  }
};
