import {Injectable} from '@nestjs/common';
import {PassportStrategy} from '@nestjs/passport';
import {Strategy} from 'passport-local';
import {AuthService} from './auth.service';
import 'reflect-metadata';
import {UserDto} from './dto/user.dto';

function getAuthFieldNames(dtoClass: any): {
    usernameField: string;
    passwordField: string;
} {
    const authFields = Reflect.getMetadata('authFields', dtoClass);
    if (!authFields || !authFields.username || !authFields.password) {
        throw new Error(
            `Fields decorated with @AuthField('username') and @AuthField('password') not found in ${dtoClass.name}`,
        );
    }
    return {
        usernameField: authFields.username,
        passwordField: authFields.password,
    };
}

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
    private readonly usernameField: string;
    private readonly passwordField: string;

    constructor(protected readonly authService: AuthService) {
        const {usernameField, passwordField} = getAuthFieldNames(UserDto);

        super({
            usernameField,
            passwordField,
        });

        this.usernameField = usernameField;
        this.passwordField = passwordField;
    }

    async validate(username: string, password: string): Promise<any> {
        return this.authService.validateUser(
            username,
            password,
            this.usernameField,
        );
    }
}
