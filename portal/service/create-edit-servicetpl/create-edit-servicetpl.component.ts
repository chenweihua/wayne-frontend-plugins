import {Component, OnInit, ViewChild} from '@angular/core';
import {Location} from '@angular/common';
import 'rxjs/add/operator/debounceTime';
import 'rxjs/add/operator/distinctUntilChanged';
import {NgForm} from "@angular/forms";
import {MessageHandlerService} from "../../../../src/app/shared/message-handler/message-handler.service";
import {ActionType, appLabelKey, namespaceLabelKey} from "../../../../src/app/shared/shared.const";
import {ActivatedRoute, Router} from "@angular/router";
import {Observable} from "rxjs/Observable";
import {App} from "../../../../src/app/shared/model/v1/app";
import {AppService} from "../../../../src/app/shared/client/v1/app.service";
import {CacheService} from "../../../../src/app/shared/auth/cache.service";
import {AceEditorService} from "../../../../src/app/shared/ace-editor/ace-editor.service";
import {AceEditorMsg} from "../../../../src/app/shared/ace-editor/ace-editor";
import {defaultService} from "../../../../src/app/shared/default-models/service.const";
import {mergeDeep} from "../../../../src/app/shared/utils";
import {Service} from "../../../shared/model/service";
import {ServiceTpl} from "../../../shared/model/servicetpl";
import {KubeService, ServicePort} from "../../../shared/model/kubernetes/service";
import {ServiceTplService} from "../../../shared/client/v1/servicetpl.service";
import {ServiceService} from "../../../shared/client/v1/service.service";
import {AuthService} from "../../../../src/app/shared/auth/auth.service";

@Component({
  selector: 'create-edit-servicetpl',
  templateUrl: 'create-edit-servicetpl.component.html',
  styleUrls: ['create-edit-servicetpl.scss']
})
export class CreateEditServiceTplComponent implements OnInit {
  ngForm: NgForm;
  @ViewChild('ngForm')
  currentForm: NgForm;

  serviceTpl: ServiceTpl = new ServiceTpl();
  checkOnGoing: boolean = false;
  isSubmitOnGoing: boolean = false;
  actionType: ActionType;
  app: App;
  service: Service;
  kubeService: KubeService = new KubeService();

  labelSelector = [];
  headless: boolean;


  constructor(private serviceTplService: ServiceTplService,
              private serviceService: ServiceService,
              private location: Location,
              private router: Router,
              private appService: AppService,
              private route: ActivatedRoute,
              public authService: AuthService,
              public cacheService: CacheService,
              private aceEditorService: AceEditorService,
              private messageHandlerService: MessageHandlerService) {
  }


  get appLabelKey(): string {
    return this.authService.config[appLabelKey]
  }

  initDefault() {
    this.kubeService = JSON.parse(defaultService);
    this.kubeService.spec.ports.push(this.defaultPort());
  }

  onAddPort() {
    this.kubeService.spec.ports.push(this.defaultPort());
  }

  onDeletePort(index: number) {
    this.kubeService.spec.ports.splice(index, 1);
  }

  onAddSelector() {
    this.labelSelector.push({"key": "", "value": ""});
  }

  onDeleteSelector(index: number) {
    this.labelSelector.splice(index, 1);
  }

  parseLabelSelectors() {
    if (this.kubeService.spec.selector) {
      this.labelSelector = [];
      Object.getOwnPropertyNames(this.kubeService.spec.selector).map(key => {
        this.labelSelector.push({"key": key, "value": this.kubeService.spec.selector[key]});
      });
    }
  }

  defaultPort(): ServicePort {
    let port = new ServicePort();
    port.protocol = "TCP";
    return port;
  }

  ngOnInit(): void {
    this.initDefault();
    let appId = parseInt(this.route.parent.snapshot.params['id']);
    let namespaceId = this.cacheService.namespaceId;
    let serviceId = parseInt(this.route.snapshot.params['serviceId']);
    let tplId = parseInt(this.route.snapshot.params['tplId']);
    let observables = Array(
      this.appService.getById(appId, namespaceId),
      this.serviceService.getById(serviceId, appId),
    );
    if (tplId) {
      this.actionType = ActionType.EDIT;
      observables.push(this.serviceTplService.getById(tplId, appId));
    } else {
      this.actionType = ActionType.ADD_NEW;
    }
    Observable.combineLatest(observables).subscribe(
      response => {
        this.app = response[0].data;
        this.service = response[1].data;
        let tpl = response[2];
        if (tpl) {
          this.serviceTpl = tpl.data;
          this.serviceTpl.description = null;
          this.saveServiceTpl(JSON.parse(this.serviceTpl.template));
        } else {
          this.labelSelector.push({"key": "app", "value": this.app.name});
        }
      },
      error => {
        this.messageHandlerService.handleError(error);
      }
    );
  }


  onCancel() {
    this.currentForm.reset();
    this.location.back();
  }

  onSubmit() {
    if (this.isSubmitOnGoing) {
      return;
    }
    this.isSubmitOnGoing = true;

    let newService = JSON.parse(JSON.stringify(this.kubeService));
    newService = this.generateService(newService);
    this.serviceTpl.serviceId = this.service.id;
    this.serviceTpl.template = JSON.stringify(newService);

    this.serviceTpl.id = undefined;
    this.serviceTpl.name = this.service.name;
    this.serviceTplService.create(this.serviceTpl, this.app.id).subscribe(
      status => {
        this.isSubmitOnGoing = false;
        this.messageHandlerService.showSuccess('创建负载均衡模版成功！');
        this.router.navigate([`portal/namespace/${this.cacheService.namespaceId}/app/${this.app.id}/service/${this.service.id}`]);
      },
      error => {
        this.isSubmitOnGoing = false;
        this.messageHandlerService.handleError(error);

      }
    );
  }

  public get isValid(): boolean {
    return this.currentForm &&
      this.currentForm.valid &&
      !this.isSubmitOnGoing &&
      !this.checkOnGoing;
  }

  buildLabels(labels: {}) {
    if (!labels) {
      labels = {};
    }
    labels[this.authService.config[appLabelKey]] = this.app.name;
    labels[this.authService.config[namespaceLabelKey]] = this.cacheService.currentNamespace.name;
    labels["app"] = this.service.name;
    return labels;
  }

  generateService(kubeService: KubeService): KubeService {
    if (this.labelSelector && this.labelSelector.length > 0) {
      kubeService.spec.selector = {};
      for (let selector of this.labelSelector) {
        kubeService.spec.selector[selector.key] = selector.value;
      }
    }
    if (this.headless) {
      kubeService.spec.clusterIP = "None";
    } else {
      kubeService.spec.clusterIP = undefined;
    }
    if (kubeService.spec.ports && kubeService.spec.ports.length > 0) {
      for (let i = 0; i < kubeService.spec.ports.length; i++) {
        kubeService.spec.ports[i].name = this.service.name + "-" + kubeService.spec.ports[i].port;
      }
    }

    kubeService.metadata.name = this.service.name;
    kubeService.metadata.labels = this.buildLabels(this.kubeService.metadata.labels);
    return kubeService;
  }

  openModal(): void {
    // let copy = Object.assign({}, myObject).
    // but this wont work for nested objects. SO an alternative would be
    let newService = JSON.parse(JSON.stringify(this.kubeService));
    newService = this.generateService(newService);
    this.aceEditorService.announceMessage(AceEditorMsg.Instance(newService, true));
  }

  saveServiceTpl(kubeService: KubeService) {
    this.fillDefault(kubeService);
  }

  fillDefault(kubeService: KubeService) {
    this.kubeService = mergeDeep(JSON.parse(defaultService), kubeService);
    if (this.kubeService.spec.clusterIP === "None") {
      this.headless = true;
    }
    this.parseLabelSelectors();
  }


}

