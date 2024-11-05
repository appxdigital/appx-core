  import { InputType } from '@nestjs/graphql';
  import { PickType } from '@nestjs/mapped-types';
  import { UserDto } from './user.dto';

  @InputType()
  export class RegisterDto extends PickType(UserDto, [
    'email',
    'password',
  ] as const) {}
