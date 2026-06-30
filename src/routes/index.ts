import { Router } from 'express';
import { authRouter } from '@modules/auth/auth.routes';
import { deviceRouter } from '@modules/device/device.routes';
import { groupRouter } from '@modules/group/group.routes';
import { otpRouter } from '@modules/otp/otp.routes';
import { projectRouter } from '@modules/project/project.routes';
import { routingRouter } from '@modules/routing/routing.routes';
import { serviceRegistryRouter } from '@modules/service-registry/registry.routes';

/**
 * Tüm modül route'larının birleştirildiği ana router.
 */
export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/devices', deviceRouter);
apiRouter.use('/groups', groupRouter);
apiRouter.use('/otp', otpRouter);
apiRouter.use('/projects', projectRouter);
apiRouter.use('/routing-rules', routingRouter);
apiRouter.use('/service-registry', serviceRegistryRouter);
