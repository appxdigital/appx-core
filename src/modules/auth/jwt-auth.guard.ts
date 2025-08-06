import {Injectable, ExecutionContext} from '@nestjs/common';
import {AuthGuard} from '@nestjs/passport';
import {GqlExecutionContext} from '@nestjs/graphql';
import {transformContext} from '../../common/utils/context-transformer.util';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    getRequest(context: ExecutionContext) {
        if (context.getType() === 'http') {
            return transformContext(context).req;
        } else {
            const gqlCtx = GqlExecutionContext.create(context);
            return gqlCtx.getContext().req;
        }
    }
}
