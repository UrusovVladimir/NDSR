# ~NDSR~ **Stand for Tech-support KEENETIC**


### **TERRAFORM**

### ```Установка terraform и запуск template ```
 **Для установки terraform и выполнении деплоя с локальной машины, неободимо выполнить следующее:**

- Если доcтуп в интернет, осуществляемом не через шлюзы в РФ, мы можем напрямую воспользоваться установкой из [официальных источников](https://developer.hashicorp.com/terraform/install)  
Пример установки на Ubuntu: 
```sh
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform
```
- Если доступ через РФ, то скачиваем релиз(на момент написания 28.02.2024 был актуален 1.7.4) через зеркала yandex.
Cоздаём папку **Deploy_nddr** к примеру ```mkdir ~/Deploy_ndsr && cd ~/Deploy_ndsr``` далее скачиваем и распаковываем
```sh
wget https://hashicorp-releases.yandexcloud.net/terraform/1.7.3/terraform_1.7.3_linux_amd64.zip && unzip ./terraform_1.7.3_linux_amd64.zip && rm ./terraform_1.7.3_linux_amd64.zip
```
>После распаковки необходимо прописать в переменную PATH путь к папке, в которой находится исполняемый файл: ```export PATH=$PATH:~/Deploy_ndsr/terraform```

- Далее для управления и создания самой vm необходим инструмент [ovftools](https://developer.vmware.com/web/tool/4.4.0/ovf/) 
скачиваем и распаковываем в туже папку которую создали шагом ранее, если устанавливали через офф репозиторий, тогда создаем также папку **Deploy_ndsr**  и туда выполнияем действия по скачиванию и распаковке:
```sh
wget https://vdc-download.vmware.com/vmwb-repository/dcr-public/342c5e55-1053-45c3-afe7-6d60a975a3f5/60ff09ea-612f-47e5-ad26-7ae42562674d/VMware-ovftool-4.4.3-18663434-lin.i386.zip && unzip VMware-ovftool-4.4.3-18663434-lin.i386.zip && rm ./VMware-ovftool-4.4.3-18663434-lin.i386.zip
```
>После распаковки также как и с terraform необходимо прописать в переменную PATH путь к папке, в которой находится исполняемый файл: ```export PATH=$PATH:/home/vladimir/Documents/ovftool```

создаём папку **Deploy_ndsr**  к примеру ```mkdir ~/Deploy_nddr && cd ~/Deploy_ndsr``` скачиваем релиз 1.7.3 terraform и 4.4.3 версию ovftools по следующим ссылкам:



### Создаём виртуальную машину для docker на esxi хосте.

### **```В переменные terraform проекта, небходимо добавить: ```**
- Переменную ssh(для подключения terraform провайдера к docker хосту) 
- Переменную password(для подключения к esxi хосту)
- Переменную esxi_username(пользователь на esxi хосте которому разрешено запускать раскатку проекта)

### ```Запус terraform проекта:```
- Переходим в папку c terraform template
- Выполняем init для того чтобы установить provider esxi и template ```terraform init```
- Предварительно смотрим, какие изменения terraform собирается произвести ```terraform plan``` эту команду лучше делать всегда перед применением любых изменений в проекте.
- Для того чтобы запустить инстанс выполняем команду ```terraform apply -auto-approve```
