<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Access control lives in database policies (has_role / can_view_project / can_edit_project); UI checks only hide controls. Why: clients and partners must never read projects they aren't members of.
- Global roles (admin/partner/client) live in user_roles; per-project access lives in project_members.access ('partner' edits, 'client' views+comments). Why: same person can have different access per project.
- Accounts are invite-only: public sign-up is disabled and admins create users via the createPortalUser server function; the first account ever created becomes admin via trigger.
- Project files go in the private `project-files` bucket under `<project_id>/...` and are opened via signed URLs. Why: storage policies key off the first folder.
- Project stages/statuses are defined in src/lib/constants.ts (text columns, not enums). Why: easy to rename/extend without migrations.
- Brand identity is shown through src/components/BrandMark.tsx (the supplied logo asset, with a recoloured light variant for the dark sidebar) and never redrawn, restyled or retyped as text. Why: the uploaded logo is the approved brand mark and must stay consistent across surfaces.
