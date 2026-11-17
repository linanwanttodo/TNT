# create the docker file

cat > Dockerfile << 'EOF'
FROM ubuntu:latest
ENV DEBIAN_FRONTEND=noninteractive
# Install SSH server
RUN apt-get update && apt-get install -y openssh-server
# Configure SSH
RUN mkdir /var/run/sshd
# Allow root login
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config
# SSH login fix
RUN sed 's@session\s*required\s*pam_loginuid.so@session optional pam_loginuid.so@g' -i /etc/pam.d/sshd
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D"]
EOF

docker build -t continue-ubuntu-ssh . # build the image

rm Dockerfile # remove the created Dockerfile

container_name="continue-ssh-container"

docker run -d -p 127.0.0.1:2222:22 --name $container_name continue-ubuntu-ssh # run the container

# set a random one-off root password at runtime; no credential is stored in the image or this repo
root_password=$(openssl rand -base64 18)
echo "root:${root_password}" | docker exec -i $container_name chpasswd

echo "docker container ${container_name} running on port 2222"

# add the instructions
bold=$(tput bold)
normal=$(tput sgr0)

echo "\n--------------------------------------"
echo "now ssh into vscode (using remote explorer) with the following command: ${bold}ssh root@localhost -p 2222${normal}"
echo "use the following password - \"${bold}${root_password}${normal}\""
