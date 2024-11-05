import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';
import { transformContext } from '../../common/utils/context-transformer.util';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  getRequest(context: ExecutionContext) {
    if (context.getType() === 'http') {
      const { req } = transformContext(context);
      return req;
    } else {
      const gqlContext = GqlExecutionContext.create(context);
      const { req } = gqlContext.getContext();
      req.body = gqlContext.getArgs().loginInput;
      return req;
    }
  }
}
