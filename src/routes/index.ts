import { Router } from 'express';
import { authRouter } from '@modules/auth/auth.routes';
import { otpRouter } from '@modules/otp/otp.routes';

/**
 * Tüm modül route'larının birleştirildiği ana router.
 * Modüller (auth, otp, project) ilerleyen fazlarda buraya eklenir.
 */
export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/otp', otpRouter);

// FAZ 4+: apiRouter.use('/projects', projectRouter);
