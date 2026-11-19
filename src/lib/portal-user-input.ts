import { z } from "zod";

export const portalUserInput = z.object({
  email: z.string().trim().email("Valid email required").max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  full_name: z.string().trim().min(1, "Full name required").max(200),
  company: z.string().trim().max(300).optional(),
  role: z.enum(["admin", "partner", "client"]),
}).strict();
export type PortalUserInput = z.infer<typeof portalUserInput>;
