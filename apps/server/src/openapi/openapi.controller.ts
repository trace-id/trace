import { Controller, Get, Header } from '@nestjs/common';
import { Auth } from '../common/auth.js';
import { OPENAPI_SPEC } from './spec.js';

/** Machine-readable API description for code generators, API clients and AI agents. Public: it holds no data. */
@Controller()
export class OpenApiController {
  @Get('openapi.json')
  @Auth('none')
  @Header('Cache-Control', 'public, max-age=3600')
  spec(): typeof OPENAPI_SPEC {
    return OPENAPI_SPEC;
  }
}
