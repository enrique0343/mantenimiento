import * as store from '../integraciones/sgo/store.mjs';
import { createSgoApi, createSnapshotPublisher } from './api.mjs';
export const handleSgoRequest = createSgoApi({ store });
export const handleSnapshotPublish = createSnapshotPublisher({ store });
