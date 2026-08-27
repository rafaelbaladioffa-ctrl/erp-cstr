from django.db.models.signals import m2m_changed, post_save, pre_save
from django.dispatch import receiver

from core.models import Collaborator, notify_user

from .models import Project, ProjectTask

TRACKED_PROJECT_FIELDS = (
    "name",
    "po",
    "link_count",
    "has_rack_positions",
    "client_id",
    "site_id",
    "category_id",
    "project_type_id",
    "description",
    "notes",
    "status",
    "planned_start",
    "planned_end",
    "actual_start",
    "actual_end",
    "is_active",
)


@receiver(pre_save, sender=Project)
def capture_old_project(sender, instance, **kwargs):
    instance._old = Project.objects.filter(pk=instance.pk).first() if instance.pk else None


def _responsible_user(project, field):
    responsible = getattr(project, field, None)
    if responsible and responsible.person_id and responsible.person.user_id:
        return responsible.person.user
    return None


@receiver(post_save, sender=Project)
def notify_project_changes(sender, instance, created, **kwargs):
    old = getattr(instance, "_old", None)
    notified_user_ids = set()

    for field in ("responsible_cstr", "responsible_client"):
        new_id = getattr(instance, f"{field}_id", None)
        old_id = getattr(old, f"{field}_id", None) if old else None
        if new_id and new_id != old_id:
            user = _responsible_user(instance, field)
            if user and user.pk not in notified_user_ids:
                notify_user(
                    user,
                    title="Você foi definido como responsável",
                    message=f'Você foi definido como responsável pelo projeto "{instance.name}".',
                    url=f"/projetos/{instance.pk}",
                    project_id=instance.pk,
                    project_code=instance.code,
                )
                notified_user_ids.add(user.pk)

    if not created and old:
        changed = any(getattr(instance, f, None) != getattr(old, f, None) for f in TRACKED_PROJECT_FIELDS)
        if changed:
            for field in ("responsible_cstr", "responsible_client"):
                user = _responsible_user(instance, field)
                if user and user.pk not in notified_user_ids:
                    notify_user(
                        user,
                        title="Projeto atualizado",
                        message=f'O projeto "{instance.name}" foi atualizado.',
                        url=f"/projetos/{instance.pk}",
                        project_id=instance.pk,
                        project_code=instance.code,
                    )
                    notified_user_ids.add(user.pk)


@receiver(m2m_changed, sender=ProjectTask.collaborators.through)
def notify_task_assignment(sender, instance, action, pk_set, **kwargs):
    if action != "post_add" or not pk_set:
        return
    for collaborator in Collaborator.objects.filter(pk__in=pk_set).select_related("person__user"):
        user = collaborator.person.user if collaborator.person_id else None
        if not user:
            continue
        notify_user(
            user,
            title="Nova tarefa atribuída",
            message=f'Você foi atribuído à tarefa "{instance.display_name}" no projeto "{instance.project.name}".',
            url=f"/projetos/{instance.project_id}",
            project_id=instance.project_id,
            project_code=instance.project.code,
        )
