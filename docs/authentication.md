# Authentication & overriding framework internals

The framework ships a working auth surface. When you need to change part of it —
add a field to registration, add endpoints, swap a Passport strategy — you don't
fork it: you **extend the exported classes and register your own versions**. This
page shows the pattern (auth is the main example, but it applies to any exported
framework class).

---

## What `AuthModule` provides

**Always wire it as `AuthModule.forRoot()`** — importing the bare `AuthModule`
registers nothing (all wiring lives in `forRoot()` so the controller can be
conditionally omitted; see the override section). `AuthModule.forRoot()` registers,
under the `/auth` prefix:

| Route | Guard | Body |
|---|---|---|
| `POST /auth/register` | — | `RegisterDto` (`email`, `password`) |
| `POST /auth/login` | `LocalAuthGuard` | credentials |
| `POST /auth/login/jwt` | `LocalAuthGuard` | credentials → tokens |
| `POST /auth/refresh` | `RefreshTokenGuard` | refresh token |
| `POST /auth/logout` · `logout/jwt` | `AuthenticatedGuard` | — |
| `GET /auth/me`, `GET/POST /auth/sessions…` | `AuthenticatedGuard` | — |

plus the providers (all **global**): `AuthService`, the Passport strategies
(`LocalStrategy`, `JwtStrategy`, `RefreshTokenStrategy`), the guards
(`LocalAuthGuard`, `JwtAuthGuard`, `AuthenticatedGuard`, `RefreshTokenGuard`,
`SessionAuthGuard`), and `SessionSerializer`.

**Registration is intentionally narrow.** `RegisterDto` accepts only `email` +
`password`, and `AuthService.register` creates the user with `BYPASS_FILTERING`
(it's an unauthenticated flow, so ABAC create-enforcement can't gate it). The
`RegisterDto` whitelist is therefore the *only* thing controlling which fields a
sign-up may set — which is exactly why widening it is a deliberate override, not
a config toggle.

All of these are exported from the package root — **import from
`@appxdigital/appx-core`, never from `@appxdigital/appx-core/dist/...`** (deep
paths are internal and can move between versions):

```ts
import {
  AuthModule, AuthController, AuthService,
  RegisterDto, UserDto, AuthField,
  LocalStrategy, JwtStrategy, RefreshTokenStrategy,
} from '@appxdigital/appx-core';
```

---

## The override pattern

To replace or extend an auth endpoint **at the same `/auth` prefix**:

1. **Extend** the framework class (controller / service / strategy).
2. Put your version in **your own module**.
3. Import **`AuthModule.forRoot({ controller: false })`** — this keeps every auth
   provider global but drops the built-in `AuthController`, so *your* controller
   owns `/auth` with no duplicate route.
4. Register your module in `AppModule` (in place of a bare `AuthModule`).

```ts
// app.module.ts
@Module({
  imports: [
    AppxCoreModule.forRoot(PermissionsConfig),
    AuthModule.forRoot({ controller: false }), // providers only, no built-in controller
    MyAuthModule,                              // your controller/service live here
    // …
  ],
})
export class AppModule {}
```

```ts
// my-auth.module.ts
@Module({
  controllers: [MyAuthController],
  providers: [/* MyAuthService, MyLocalStrategy, … as needed */],
})
export class MyAuthModule {}
```

> **Why `forRoot({ controller: false })`?** If the built-in controller *and* your
> own `/auth` controller are both registered, you get two handlers for the same
> routes (Express runs the first-registered, so the base `RegisterDto` would win
> and reject your extra fields). `forRoot({ controller: false })` drops the built-in
> controller while keeping every provider global, so your controller takes over
> cleanly. Use plain `AuthModule.forRoot()` (no options) when you're *not*
> overriding the controller.

---

## Recipe 1 — add a field to registration (e.g. `name`)

Extend `RegisterDto`, then override the inherited `register` handler:

```ts
// register-local.dto.ts
import { RegisterDto } from '@appxdigital/appx-core';
import { IsOptional, IsString } from 'class-validator';

export class RegisterLocalDto extends RegisterDto {
  @IsOptional()
  @IsString()
  name?: string;
}
```

```ts
// my-auth.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { AuthController } from '@appxdigital/appx-core';
import { RegisterLocalDto } from './register-local.dto';

@Controller('auth')
export class MyAuthController extends AuthController {
  @Post('register')
  async register(@Body() dto: RegisterLocalDto) {
    return this.authService.register(dto); // authService is `protected` on AuthController
  }
}
```

`AuthService.register` spreads the DTO straight into the user create, so `name`
persists (your `User` model must have the column). Everything else on
`AuthController` — login, refresh, sessions — is inherited unchanged. The global
validation pipe now validates the body against `RegisterLocalDto`, so `name` is
accepted and any *other* unknown field still `400`s.

> Keep registration a **narrow allowlist** — only add fields a self-service
> sign-up should legitimately set. Never widen it to privileged columns (`role`,
> tenant, ownership ids); mark those `/// @NoWrite` and set them server-side.

---

## Recipe 2 — extend the service (add methods / change behaviour)

Extend `AuthService` and forward its constructor. Its signature is
`(userService, prisma, jwtService, configService)`:

```ts
import { Injectable } from '@nestjs/common';
import { AuthService, PrismaService } from '@appxdigital/appx-core';
import { UserService } from '../user/user.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class MyAuthService extends AuthService {
  constructor(
    userService: UserService,
    prisma: PrismaService,
    jwtService: JwtService,
    configService: ConfigService,
  ) {
    super(userService, prisma, jwtService, configService);
  }

  async handleForgotPassword(email: string) { /* … */ }
}
```

Provide `MyAuthService` in your module and inject it in your controller
(`super(myAuthService)` if the controller extends `AuthController`). Because you
imported `AuthModule.forRoot({ controller: false })`, `UserService`, `JwtService`,
`PrismaService`, and `ConfigService` are all already available to inject.

---

## Recipe 3 — override a Passport strategy

The built-in `LocalStrategy` reads the username/password field names from
`@AuthField(...)` metadata on `UserDto` and delegates to
`AuthService.validateUser`. To change credential validation, extend it (or
`JwtStrategy` / `RefreshTokenStrategy`) and provide your version:

```ts
import { Injectable } from '@nestjs/common';
import { LocalStrategy } from '@appxdigital/appx-core';

@Injectable()
export class MyLocalStrategy extends LocalStrategy {
  async validate(username: string, password: string) {
    // custom checks, then fall back to the framework behaviour:
    return super.validate(username, password);
  }
}
```

```ts
@Module({
  controllers: [MyAuthController],
  providers: [MyLocalStrategy], // Passport picks up the last-registered strategy of this name
})
export class MyAuthModule {}
```

> Passport registers strategies by name. Providing your own `LocalStrategy`
> subclass in your module (with `AuthModule.forRoot({ controller: false })` for
> the rest) makes yours the active `local` strategy.

---

## The general principle

This isn't auth-specific. Every framework class you might need to specialise is
exported from `@appxdigital/appx-core`. To override inner functionality:

1. **Extend** the exported class.
2. **Provide** your subclass in your own module (a subclass provider shadows the
   base where you inject it).
3. When the framework module would *also* register the thing you're replacing
   (a controller, a route), import it in a mode that omits that piece — e.g.
   `AuthModule.forRoot({ controller: false })` — so there's no duplicate.

If a class you need to extend isn't exported, that's a framework gap — open it
rather than deep-importing from `dist/`.
