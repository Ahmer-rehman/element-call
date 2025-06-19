FOR /F "tokens=*" %%i IN ('docker ps -aq') DO docker rm -f %%i
FOR /F "tokens=*" %%i IN ('docker images -aq') DO docker rmi -f %%i
