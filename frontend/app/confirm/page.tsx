import ConfirmSignUpForm from "@/components/auth/ConfirmSignUpForm";

export default async function ConfirmPage(props: PageProps<"/confirm">) {
  const { email } = await props.searchParams;
  return <ConfirmSignUpForm initialEmail={typeof email === "string" ? email : ""} />;
}
