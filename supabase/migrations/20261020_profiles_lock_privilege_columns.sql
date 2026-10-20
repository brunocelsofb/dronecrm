-- Achado crítico da auditoria (run-1): qualquer usuário logado alterava o próprio
-- role / is_super_admin / tenant_id / impersonating_tenant_id pela API do banco.
--
-- Regra: pela sessão do usuário (anon/authenticated) só é possível
--   - editar o PRÓPRIO nome, cargo e assinatura de e-mail;
--   - criar o PRÓPRIO perfil no cadastro (id, nome, e-mail).
-- Papel, departamento, perfil de acesso, empresa, Super Admin e "Acessar" só pelo
-- servidor (chave de serviço), que já faz as checagens (users.ts, impersonate.ts).

-- 1) Permissões por coluna
revoke insert, update, delete, truncate on contract_crm.profiles from anon, authenticated;
grant update (full_name, job_title, email_signature) on contract_crm.profiles to authenticated;
grant insert (id, full_name, email) on contract_crm.profiles to authenticated;

-- 2) [PENDENTE — não aplicado em 20/10: o drop policy foi cancelado; aguarda confirmação]
--    Políticas: UPDATE só da própria linha. As políticas ALL amplas viram só leitura.
drop policy if exists profiles_update on contract_crm.profiles;
drop policy if exists admin_update_any_profile on contract_crm.profiles;
drop policy if exists update_own_profile_non_role_fields on contract_crm.profiles;
create policy update_own_profile_non_role_fields on contract_crm.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists tenant_isolation on contract_crm.profiles;
drop policy if exists super_admin_all on contract_crm.profiles;
-- Leitura continua coberta por own_profile / profiles_select (+ tenant_guard RESTRICTIVE).

-- 3) Trava extra: mesmo que um grant volte por engano, a sessão do usuário não muda privilégios.
--    SECURITY INVOKER de propósito: current_user é o papel da requisição (anon/authenticated).
create or replace function contract_crm.protect_profile_privileges() returns trigger
language plpgsql set search_path = contract_crm, pg_temp as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new; -- servidor (service_role), migrações e funções da plataforma
  end if;
  if tg_op = 'INSERT' then
    new.role := 'member';
    new.is_super_admin := false;
    new.impersonating_tenant_id := null;
    new.access_profile := null;
    new.department := null;
    return new; -- tenant_id é definido por set_tenant_id()
  end if;
  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.is_super_admin is distinct from old.is_super_admin
     or new.tenant_id is distinct from old.tenant_id
     or new.impersonating_tenant_id is distinct from old.impersonating_tenant_id
     or new.access_profile is distinct from old.access_profile
     or new.department is distinct from old.department
     or new.email is distinct from old.email then
    raise exception 'profiles: campos de permissão só podem ser alterados pelo servidor' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function contract_crm.protect_profile_privileges() from public, anon, authenticated;

drop trigger if exists protect_profile_privileges on contract_crm.profiles;
create trigger protect_profile_privileges before insert or update on contract_crm.profiles
  for each row execute function contract_crm.protect_profile_privileges();
