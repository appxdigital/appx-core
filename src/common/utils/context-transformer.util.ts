import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

export function transformContext(context: ExecutionContext): {
  req: any;
  res?: any;
} {
  const contextType = context.getType();

  if (contextType === 'http') {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    return { req: request, res: response };
  } else if (context.getType() === 'rpc' || context.getType() === 'ws') {
    const client = context.switchToWs().getClient();
    return { req: client.handshake, res: null };
  } else {
    try {
      const gqlContext = GqlExecutionContext.create(context);
      return {
        req: gqlContext.getContext().req,
        res: gqlContext.getContext().res,
      };
    } catch (error) {
      throw new Error(`Unsupported context type: ${contextType}`);
    }
  }
}
