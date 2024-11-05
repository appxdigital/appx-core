import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';
import { Field, InputType } from '@nestjs/graphql';
import { AuthField } from '../auth-field.decorator';

@InputType()
export class UserDto {
  @Field()
  @IsEmail()
  @IsNotEmpty()
  @AuthField('username')
  email!: string;

  @Field()
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  @AuthField('password')
  password!: string;
}
