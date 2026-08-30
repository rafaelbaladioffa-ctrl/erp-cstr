from django.db import migrations

ACTIVITY_TYPES = [
    "Conferência de materiais",
    "Validação de rota",
    "Lançamento de cabo óptico",
    "Lançamento UTP",
    "Organização de cabo",
    "Identificação / Label",
    "Patching MPO",
    "Patching LC",
    "Certificação óptica",
    "Certificação UTP",
    "Correção de pendências",
    "Registro fotográfico",
    "Handover",
    "Outros / A Classificar",
]

PROJECT_ITEM_TYPES = [
    "Cabo óptico",
    "Cabo UTP",
    "Link",
    "Rack",
    "Equipamento",
    "Outro",
]


def seed_forward(apps, schema_editor):
    ActivityType = apps.get_model("core", "ActivityType")
    ProjectItemType = apps.get_model("core", "ProjectItemType")

    for order, name in enumerate(ACTIVITY_TYPES):
        ActivityType.objects.get_or_create(name=name, defaults={"order": order})

    for order, name in enumerate(PROJECT_ITEM_TYPES):
        ProjectItemType.objects.get_or_create(name=name, defaults={"order": order})


def seed_backward(apps, schema_editor):
    ActivityType = apps.get_model("core", "ActivityType")
    ProjectItemType = apps.get_model("core", "ProjectItemType")
    ActivityType.objects.filter(name__in=ACTIVITY_TYPES).delete()
    ProjectItemType.objects.filter(name__in=PROJECT_ITEM_TYPES).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0031_activitytype_projectitemtype"),
    ]

    operations = [
        migrations.RunPython(seed_forward, seed_backward),
    ]
