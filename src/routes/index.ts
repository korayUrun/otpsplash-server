import { Router } from 'express';
import { authRouter } from '@modules/auth/auth.routes';
import { deviceRouter } from '@modules/device/device.routes';
import { otpRouter } from '@modules/otp/otp.routes';
import { projectRouter } from '@modules/project/project.routes';

/**
 * Tüm modül route'larının birleştirildiği ana router.
 */
export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/devices', deviceRouter);
apiRouter.use('/otp', otpRouter);
apiRouter.use('/projects', projectRouter);
