import { Sermon } from '@/models/models';
import {
  getSermonsViaClient,
} from '@/services/sermons.client';

export const getSermons = async (userId: string): Promise<Sermon[]> => {
  return getSermonsViaClient(userId);
};
