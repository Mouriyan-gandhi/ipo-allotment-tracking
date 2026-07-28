import { redirect } from "next/navigation";

// The calendar moved to "/" (it is the landing view). Kept so older links,
// bookmarks and the login `?next=` parameter still resolve.
export default function CalendarRedirect() {
  redirect("/");
}
