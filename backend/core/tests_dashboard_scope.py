from django.contrib.auth import get_user_model
from django.test import TestCase

from core.models import Client, Collaborator, Company, JobTitle, Person, Responsible, Site
from projects.analytics import build_projects_performance
from projects.models import Project

User = get_user_model()


class DashboardProjectsScopeTests(TestCase):
    """Dashboard de projetos: supervisor só enxerga os projetos em que é Responsável CSTR."""

    def setUp(self):
        company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        title = JobTitle.objects.create(company=company, name="Supervisor de Infraestrutura de Redes")
        client = Client.objects.create(company=company, legal_name="Cliente")
        site = Site.objects.create(client=client, name="GRU65", code="GRU65")

        def collaborator(name, with_user=False):
            person = Person.objects.create(name=name, company=company)
            if with_user:
                person.user = User.objects.create_user(username=name.lower(), email=f"{name}@x.com", password="x")
                person.save(update_fields=["user"])
            return Collaborator.objects.create(person=person, job_title=title)

        mine = collaborator("Meu", with_user=True)
        other = collaborator("Outro")
        self.user = User.objects.get(pk=mine.person.user_id)

        def project(name, responsible):
            return Project.objects.create(
                company=company, client=client, site=site, name=name, status=Project.STATUS_IN_PROGRESS,
                responsible_cstr=Responsible.objects.create(person=responsible.person, kind=Responsible.KIND_CSTR),
            )

        self.mine = project("Projeto Meu", mine)
        self.other = project("Projeto Outro", other)

    def project_ids(self, **kwargs):
        return {row["id"] for row in build_projects_performance(**kwargs)["projects"]}

    def test_supervisor_sees_only_own_projects(self):
        self.assertEqual(self.project_ids(user=self.user), {self.mine.pk})

    def test_without_user_everything_is_listed(self):
        self.assertEqual(self.project_ids(), {self.mine.pk, self.other.pk})


class SitesPanelSupervisorScopeTests(DashboardProjectsScopeTests):
    """Gestão de Sites: mesma regra do dashboard (supervisor só vê os projetos em que é Responsável CSTR)."""

    def panel_ids(self, user):
        from projects.sites_panel import build_sites_panel

        data = build_sites_panel(user, include_technicians=False)
        return {row["id"] for row in data["projects"]}

    def test_supervisor_sees_only_own_projects_in_sites_panel(self):
        self.assertEqual(self.panel_ids(self.user), {self.mine.pk})

    def test_non_supervisor_sees_all_projects_in_sites_panel(self):
        admin = User.objects.create_superuser(username="adm", email="adm@x.com", password="x")
        self.assertEqual(self.panel_ids(admin), {self.mine.pk, self.other.pk})
