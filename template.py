from pathlib import Path

from youwol.pipelines.pipeline_typescript_weback_npm import Template, PackageType, Dependencies, \
    RunTimeDeps, generate_template

template = Template(
    path=Path(__file__).parent,
    type=PackageType.Library,
    name="@youwol/fv-tree",
    version="0.1.5-wip",
    shortDescription="Tree views using flux-view.",
    author="greinisch@youwol.com",
    dependencies=Dependencies(
        runTime=RunTimeDeps(
            load={
                "rxjs": "^6.5.5",
                "@youwol/flux-view": "^0.1.1"
            }
        ),
        devTime={
            "rxjs-spy": "7.5.3"
        }
    ),
    userGuide=True
    )

generate_template(template)
