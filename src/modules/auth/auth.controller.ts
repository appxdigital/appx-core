import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Get,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LocalAuthGuard } from './local-auth.guard';
import { AuthenticatedGuard } from './authenticated.guard';
import { Request, Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  async login(@Req() req: Request, @Res() res: Response) {
    try {
      const result = await this.authService.login(req);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ message: 'Login failed' });
    }
  }

  @UseGuards(AuthenticatedGuard)
  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      await this.authService.logout(req, res);
      res.status(200).send({ message: 'Logout successful' });
    } catch (error: any) {
      if (error.message === 'User is not authenticated.') {
        res.status(HttpStatus.BAD_REQUEST).send({
          message: 'User is not logged in or session already destroyed.',
        });
      } else {
        throw new HttpException(
          'Logout failed.',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }

  @UseGuards(AuthenticatedGuard)
  @Get('sessions')
  async getActiveSessions(@Req() req: Request) {
    const sessions = await this.authService.getActiveSessions(req);
    return { sessions };
  }

  @UseGuards(AuthenticatedGuard)
  @Post('sessions/close-my-sessions')
  async closeAllSessions(@Req() req: Request, @Res() res: Response) {
    return this.authService.closeAllUserSessions(req, res);
  }
}
