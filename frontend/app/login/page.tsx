import LoginForm from "@/components/auth/LoginForm";

export default async function LoginPage(props: PageProps<"/login">) {
  const { confirmed } = await props.searchParams;
  return <LoginForm justConfirmed={confirmed === "1"} />;
}
