import { listSupportAgents, listTasks } from "@/app/actions";
import TaskBoard from "@/components/task-board";

export default async function Home() {
  const [groups, supportAgents] = await Promise.all([listTasks("open"), listSupportAgents()]);
  return <TaskBoard initialGroups={groups} initialSupportAgents={supportAgents} />;
}
