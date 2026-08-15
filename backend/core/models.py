from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.utils import timezone


class TimestampedModel(models.Model):
    created_at = models.DateTimeField("criado em", auto_now_add=True)
    updated_at = models.DateTimeField("atualizado em", auto_now=True)

    class Meta:
        abstract = True


class Company(TimestampedModel):
    legal_name = models.CharField("razão social", max_length=255, blank=True)
    trade_name = models.CharField("nome fantasia", max_length=255, blank=True)
    tax_id = models.CharField("CNPJ/CPF", max_length=18, blank=True)
    email = models.EmailField("e-mail", blank=True)
    phone = models.CharField("telefone", max_length=20, blank=True)
    is_active = models.BooleanField("ativa", default=True)

    class Meta:
        verbose_name = "empresa"
        verbose_name_plural = "empresas"
        ordering = ("legal_name",)
        constraints = [
            models.UniqueConstraint(
                fields=("tax_id",),
                condition=~models.Q(tax_id=""),
                name="unique_nonempty_company_tax_id",
            )
        ]

    def __str__(self):
        return self.trade_name or self.legal_name or "Empresa sem identificação"


class ActiveCompanyModel(TimestampedModel):
    company = models.ForeignKey(
        Company,
        verbose_name="empresa",
        on_delete=models.PROTECT,
        related_name="%(class)ss",
    )
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        abstract = True


class Site(TimestampedModel):
    client = models.ForeignKey(
        "Client",
        verbose_name="cliente",
        on_delete=models.PROTECT,
        related_name="sites",
    )
    is_active = models.BooleanField("ativo", default=True)
    name = models.CharField("nome", max_length=150, blank=True)
    code = models.CharField("código", max_length=30, blank=True)
    address = models.CharField("endereço", max_length=255, blank=True)
    city = models.CharField("cidade", max_length=100, blank=True)
    state = models.CharField("UF", max_length=2, blank=True)
    manual_coordinates = models.BooleanField(
        "coordenadas manuais",
        default=False,
        help_text="Marque para informar latitude/longitude manualmente. Enquanto marcado, a geocodificação "
        "automática não sobrescreve os valores digitados.",
    )
    latitude = models.DecimalField(
        "latitude", max_digits=9, decimal_places=6, null=True, blank=True,
        help_text="Preenchida automaticamente a partir do endereço, a menos que 'coordenadas manuais' esteja marcado.",
    )
    longitude = models.DecimalField(
        "longitude", max_digits=9, decimal_places=6, null=True, blank=True,
        help_text="Preenchida automaticamente a partir do endereço, a menos que 'coordenadas manuais' esteja marcado.",
    )
    geocoded_address = models.CharField(
        "endereço geocodificado", max_length=400, blank=True, editable=False,
        help_text="Guarda o endereço que gerou a última latitude/longitude, para saber quando regeocodificar.",
    )

    class Meta:
        verbose_name = "site"
        verbose_name_plural = "sites"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("client", "code"),
                condition=~models.Q(code=""),
                name="unique_site_code_per_client",
            )
        ]

    def __str__(self):
        return " - ".join(filter(None, (self.code, self.name))) or "Site sem identificação"

    @property
    def full_address(self):
        return ", ".join(filter(None, (self.address, self.city, self.state, "Brasil")))

    def save(self, *args, **kwargs):
        address = self.full_address

        if self.manual_coordinates:
            # Respeita as coordenadas digitadas no admin; não chama a
            # geocodificação automática nem as sobrescreve.
            self.geocoded_address = address
            super().save(*args, **kwargs)
            return

        if not address:
            self.latitude = None
            self.longitude = None
            self.geocoded_address = ""
            super().save(*args, **kwargs)
            return

        needs_geocoding = address != self.geocoded_address or self.latitude is None or self.longitude is None
        if needs_geocoding:
            from .geocoding import geocode_site_address

            result = geocode_site_address(self.address, self.city, self.state)
            if result:
                self.latitude, self.longitude = result
                self.geocoded_address = address
            # Se a geocodificação falhar (rate limit, endereço não
            # encontrado, erro de rede), NÃO marcamos geocoded_address como
            # concluído — assim o próximo save() tenta de novo, em vez de
            # deixar o site permanentemente "Sem coordenadas".
        super().save(*args, **kwargs)


class JobTitle(ActiveCompanyModel):
    name = models.CharField("nome", max_length=100, blank=True)
    description = models.TextField("descrição", blank=True)

    class Meta:
        verbose_name = "cargo"
        verbose_name_plural = "cargos"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("company", "name"),
                condition=~models.Q(name=""),
                name="unique_job_title_name_per_company",
            )
        ]

    def __str__(self):
        return self.name or "Cargo sem identificação"


class Collaborator(ActiveCompanyModel):
    name = models.CharField("nome", max_length=150, blank=True)
    registration = models.CharField("matrícula", max_length=30, blank=True)
    yellow_badge = models.CharField("Yellow Badge", max_length=50, blank=True)
    job_title = models.ForeignKey(
        JobTitle,
        verbose_name="cargo",
        on_delete=models.SET_NULL,
        related_name="collaborators",
        null=True,
        blank=True,
    )
    email = models.EmailField("e-mail", blank=True)
    phone = models.CharField("telefone", max_length=20, blank=True)
    sites = models.ManyToManyField(Site, verbose_name="sites", related_name="collaborators", blank=True)
    user = models.OneToOneField(
        "users.User",
        verbose_name="usuário vinculado",
        on_delete=models.SET_NULL,
        related_name="collaborator_profile",
        null=True,
        blank=True,
    )
    manager = models.ForeignKey(
        "self",
        verbose_name="gestor",
        on_delete=models.SET_NULL,
        related_name="direct_reports",
        null=True,
        blank=True,
        limit_choices_to=(
            models.Q(job_title__name__icontains="Supervisor")
            | models.Q(job_title__name__icontains="Coordenador")
            | models.Q(job_title__name__icontains="Gerente")
        ),
    )

    class Meta:
        verbose_name = "colaborador"
        verbose_name_plural = "colaboradores"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("company", "registration"),
                condition=~models.Q(registration=""),
                name="unique_collaborator_registration_per_company",
            ),
            models.UniqueConstraint(
                fields=("company", "yellow_badge"),
                condition=~models.Q(yellow_badge=""),
                name="unique_collaborator_yellow_badge_per_company",
            ),
        ]

    def __str__(self):
        return self.name or self.registration or "Colaborador sem identificação"

    def clean(self):
        super().clean()
        errors = {}
        if self.manager_id and self.pk and self.manager_id == self.pk:
            errors["manager"] = "O colaborador não pode ser seu próprio gestor."
        if self.manager_id and self.company_id and self.manager.company_id != self.company_id:
            errors["manager"] = "O gestor deve pertencer à mesma empresa do colaborador."
        if self.user_id and self.company_id and self.user.company_id != self.company_id:
            errors["user"] = "O usuário deve pertencer à mesma empresa do colaborador."
        if errors:
            raise ValidationError(errors)


class Responsible(ActiveCompanyModel):
    name = models.CharField("nome", max_length=150, blank=True)
    email = models.EmailField("e-mail", blank=True)
    phone = models.CharField("telefone", max_length=20, blank=True)
    user = models.OneToOneField(
        "users.User",
        verbose_name="usuário vinculado",
        on_delete=models.SET_NULL,
        related_name="responsible_profile",
        null=True,
        blank=True,
    )

    class Meta:
        verbose_name = "responsável"
        verbose_name_plural = "responsáveis"
        ordering = ("name",)

    def __str__(self):
        return self.name or self.email or "Responsável sem identificação"

    def clean(self):
        super().clean()
        if self.user_id and self.company_id and self.user.company_id != self.company_id:
            raise ValidationError({"user": "O usuário deve pertencer à mesma empresa do responsável."})


class Category(TimestampedModel):
    name = models.CharField("nome", max_length=100, blank=True)
    description = models.TextField("descrição", blank=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "categoria"
        verbose_name_plural = "categorias"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("name",),
                condition=~models.Q(name=""),
                name="unique_nonempty_category_name",
            )
        ]

    def __str__(self):
        return self.name or "Categoria sem identificação"


class ProjectType(TimestampedModel):
    name = models.CharField("nome", max_length=100, blank=True)
    description = models.TextField("descrição", blank=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Tipo de Projeto"
        verbose_name_plural = "Tipos de Projeto"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(
                fields=("name",),
                condition=~models.Q(name=""),
                name="unique_nonempty_project_type_name",
            )
        ]

    def __str__(self):
        return self.name or "Tipo de projeto sem identificação"


class TaskSequence(models.Model):
    year = models.PositiveIntegerField("ano", primary_key=True)
    last_number = models.PositiveIntegerField("último número", default=0)

    class Meta:
        verbose_name = "sequência de tarefas"
        verbose_name_plural = "sequências de tarefas"


class Task(TimestampedModel):
    name = models.CharField("nome", max_length=150, blank=True)
    code = models.CharField("código", max_length=30, unique=True, editable=False)
    description = models.TextField("descrição", blank=True)
    is_active = models.BooleanField("ativo", default=True)
    estimated_hours = models.DecimalField(
        "horas estimadas",
        max_digits=7,
        decimal_places=2,
        default=0,
        null=True,
        blank=True,
    )
    project_types = models.ManyToManyField(
        ProjectType,
        verbose_name="Tipos de Projeto",
        related_name="tasks",
        blank=True,
    )

    class Meta:
        verbose_name = "tarefa"
        verbose_name_plural = "tarefas"
        ordering = ("name",)

    def __str__(self):
        return " - ".join(filter(None, (self.code, self.name))) or "Tarefa sem identificação"

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)

        year = timezone.localdate().year
        with transaction.atomic():
            try:
                sequence = TaskSequence.objects.select_for_update().get(year=year)
            except TaskSequence.DoesNotExist:
                try:
                    with transaction.atomic():
                        sequence = TaskSequence.objects.create(year=year)
                except IntegrityError:
                    sequence = TaskSequence.objects.select_for_update().get(year=year)

            sequence.last_number += 1
            sequence.save(update_fields=("last_number",))
            self.code = f"CSTR-TASK-{year}{sequence.last_number:04d}"
            return super().save(*args, **kwargs)


class Client(ActiveCompanyModel):
    PERSON_TYPE_CHOICES = (("company", "Pessoa jurídica"), ("person", "Pessoa física"))

    person_type = models.CharField(
        "tipo de pessoa",
        max_length=10,
        choices=PERSON_TYPE_CHOICES,
        default="company",
        blank=True,
    )
    legal_name = models.CharField("razão social/nome", max_length=255, blank=True)
    trade_name = models.CharField("nome fantasia", max_length=255, blank=True)
    tax_id = models.CharField("CNPJ/CPF", max_length=18, blank=True)
    email = models.EmailField("e-mail", blank=True)
    phone = models.CharField("telefone", max_length=20, blank=True)
    address = models.CharField("endereço", max_length=255, blank=True)
    city = models.CharField("cidade", max_length=100, blank=True)
    state = models.CharField("UF", max_length=2, blank=True)
    notes = models.TextField("observações", blank=True)

    class Meta:
        verbose_name = "cliente"
        verbose_name_plural = "clientes"
        ordering = ("legal_name",)
        constraints = [
            models.UniqueConstraint(
                fields=("company", "tax_id"),
                condition=~models.Q(tax_id=""),
                name="unique_client_tax_id_per_company",
            )
        ]

    def __str__(self):
        return self.trade_name or self.legal_name or self.tax_id or "Cliente sem identificação"


class ClientResponsible(TimestampedModel):
    client = models.ForeignKey(
        Client,
        verbose_name="cliente",
        on_delete=models.CASCADE,
        related_name="responsibles",
    )
    name = models.CharField("nome", max_length=150)
    email = models.EmailField("e-mail", blank=True)
    phone = models.CharField("telefone", max_length=20, blank=True)
    job_title = models.CharField("cargo", max_length=100, blank=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Responsável do Cliente"
        verbose_name_plural = "Responsáveis do Cliente"
        ordering = ("name",)
        constraints = [
            models.UniqueConstraint(fields=("client", "name"), name="unique_responsible_name_per_client")
        ]

    def __str__(self):
        return self.name
