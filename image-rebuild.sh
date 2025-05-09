pushd docker
docker image rm cards
docker build -t cards .
popd

