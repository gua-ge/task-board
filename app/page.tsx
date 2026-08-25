import { listSupportAgents, listTasks, listTaskTags } from "@/app/actions";
import TaskBoard from "@/components/task-board";

export default async function Home() {
  const [groups, supportAgents, taskTags] = await Promise.all([
    listTasks("open"),
    listSupportAgents(),
    listTaskTags(),
  ]);
  return <TaskBoard initialGroups={groups} initialSupportAgents={supportAgents} initialTaskTags={taskTags} />;
}
