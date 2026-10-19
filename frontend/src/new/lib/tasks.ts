import { create } from 'zustand';
import loadNotifications, {
  type NotificationResponseType,
} from '../../api/loader/loadNotifications';
import { assertTaskNotifications, pollWhileActive, taskTransition } from './download';

export type Task = NotificationResponseType[number];

// finished/advanced are counters; subscribers add them to fetch keys to reload on change.
export const useTaskStore = create<{
  tasks: Task[];
  error: string;
  finished: number;
  advanced: number;
}>(() => ({ tasks: [], error: '', finished: 0, advanced: 0 }));

export function startTaskPolling(): () => void {
  return pollWhileActive(
    async () => {
      const response = await loadNotifications('all');
      if (response.status < 200 || response.status >= 300 || response.error)
        throw new Error(response.error?.error ?? `Request failed (${response.status})`);
      return assertTaskNotifications(response.data);
    },
    tasks => {
      const state = useTaskStore.getState();
      const { finished, advanced } = taskTransition(state.tasks, tasks);
      useTaskStore.setState({
        tasks,
        error: '',
        finished: state.finished + Number(finished),
        advanced: state.advanced + Number(advanced),
      });
      return tasks.length > 0;
    },
    busy => (busy ? 1000 : 3000),
    caught =>
      useTaskStore.setState({
        error: caught instanceof Error ? caught.message : 'Could not load task status',
      }),
  );
}
