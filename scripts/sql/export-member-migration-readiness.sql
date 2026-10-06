-- SELECT only. Use an owner/admin SQL connection; never expose Auth through a public view.
-- Replace proof_reference and verified_at using a fresh, privately saved source DOM proof.
-- This app community stores the group SLUG; the browser proves its stable GHL group ID.
-- Keep the result private. This query selects no passwords, tokens, bodies or payment details.
with context as (
  select c.id, c.external_provider, c.external_group_id,
    'eqVZcs8fro8qiGD2sgoG'::text as location_id,
    '6a5ff7019b8d5f3bf162a694'::text as group_id,
    '7-figure-turf-cleaning'::text as group_slug,
    'REPLACE_WITH_CURRENT_SOURCE_PROOF_ID'::text as proof_reference,
    'REPLACE_WITH_SOURCE_PROOF_UTC_TIMESTAMP'::text as verified_at
  from public.academy_communities c
  where c.id='fac17da0-bdb9-48c0-9c67-591d087e9912'
    and c.external_provider='highlevel'
    and c.external_group_id='7-figure-turf-cleaning'
), member_rows as (
  select m.id,m.academy_community_id,m.user_id,m.status,m.role
  from public.academy_members m join context c on c.id=m.academy_community_id
), invite_rows as (
  select i.id,i.academy_community_id,i.academy_member_id,i.email,i.status,i.invited_user_id
  from public.academy_member_invites i join context c on c.id=i.academy_community_id
), auth_rows as (
  select u.id,u.email,u.email_confirmed_at,u.banned_until,u.deleted_at
  from auth.users u
  where u.id in (select user_id from member_rows)
    or u.id in (select invited_user_id from invite_rows)
    or lower(trim(u.email)) in (select lower(trim(email)) from invite_rows)
)
select jsonb_build_object(
  'schemaVersion',1,'source','dirty-turf-member-readonly-export','coverage','complete',
  'capturedAt',now(),'academyCommunityId',c.id,
  'scope',jsonb_build_object('locationId',c.location_id,'groupId',c.group_id),
  'sourceMapping',jsonb_build_object('externalProvider',c.external_provider,
    'databaseExternalGroupId',c.external_group_id,'groupSlug',c.group_slug,
    'groupId',c.group_id,'verificationReference',c.proof_reference,'verifiedAt',c.verified_at),
  'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from member_rows m),'[]'::jsonb),
  'links',coalesce((select jsonb_agg(jsonb_build_object('academy_community_id',l.academy_community_id,
    'academy_member_id',l.academy_member_id,'external_provider',l.external_provider,
    'external_contact_id',l.external_contact_id,'external_member_id',l.external_member_id)
    order by l.academy_member_id) from public.academy_member_links l
    where l.academy_community_id=c.id and l.external_provider='highlevel'),'[]'::jsonb),
  'invites',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from invite_rows i),'[]'::jsonb),
  'authUsers',coalesce((select jsonb_agg(to_jsonb(u) order by u.id) from auth_rows u),'[]'::jsonb),
  'courses',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'academy_community_id',r.academy_community_id,'status',r.status)
    order by r.id) from public.courses r where r.academy_community_id=c.id),'[]'::jsonb),
  'accessGrants',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,
    'academy_community_id',g.academy_community_id,'academy_member_id',g.academy_member_id,
    'course_id',g.course_id,'status',g.status,'source_type',g.source_type,
    'starts_at',g.starts_at,'ends_at',g.ends_at) order by g.id)
    from public.academy_access_grants g where g.academy_community_id=c.id),'[]'::jsonb),
  'billingPlans',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,
    'academy_community_id',p.academy_community_id,'offer_kind',p.offer_kind) order by p.id)
    from public.academy_billing_plans p where p.academy_community_id=c.id),'[]'::jsonb),
  'billingSubscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,
    'academy_community_id',s.academy_community_id,'academy_member_id',s.academy_member_id,
    'plan_id',s.plan_id,'status',s.status) order by s.id)
    from public.academy_billing_subscriptions s where s.academy_community_id=c.id),'[]'::jsonb)
) as member_migration_export
from context c;
