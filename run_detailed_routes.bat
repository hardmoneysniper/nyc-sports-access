@echo off
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "C:\sports prjct\ur_sprts_dash"
python -u run_detailed_routes.py > detailed_routes_run.log 2>&1
